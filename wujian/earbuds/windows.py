"""Windows Bluetooth Classic control using Python's shipped Winsock support.

No driver, privileged shell, firmware access or third-party transport is needed.
Only paired devices named FreeBuds 4E can be selected; identity is checked again
over the control protocol before any noise-control write.
"""

from __future__ import annotations

import re
import socket
import sys
import threading
import time
from contextlib import contextmanager

from .protocol import ANC_STATE, ANC_WRITE, BATTERY, INFO, MODES, Decoder, battery_state, device_identity, encode, noise_state

_LOCKS: dict[str, threading.Lock] = {}
_LOCKS_GUARD = threading.Lock()
_ADDRESS = re.compile(r"^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$")


class EarbudError(Exception):
    def __init__(self, message: str, status="unavailable", evidence=None):
        self.status, self.evidence = status, list(evidence or [])
        super().__init__(message)


def normalize_address(address: str) -> str:
    value = address.upper().replace("-", ":")
    if len(value) == 12:
        value = ":".join(value[n:n + 2] for n in range(0, 12, 2))
    if not _ADDRESS.fullmatch(value):
        raise EarbudError("蓝牙设备地址无效", "invalid_target")
    return value


def list_devices() -> list[dict]:
    if sys.platform != "win32":
        raise EarbudError("耳机工作台需要运行物间服务的 Windows 电脑", "unsupported_host")
    import winreg

    devices = []
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Services\BTHPORT\Parameters\Devices") as key:
            index = 0
            while True:
                try:
                    name = winreg.EnumKey(key, index)
                except OSError:
                    break
                index += 1
                if not re.fullmatch(r"[0-9a-fA-F]{12}", name):
                    continue
                with winreg.OpenKey(key, name) as child:
                    try:
                        raw, _ = winreg.QueryValueEx(child, "Name")
                    except FileNotFoundError:
                        continue
                label = raw.decode("utf-8", "replace").rstrip("\x00") if isinstance(raw, bytes) else str(raw)
                if re.fullmatch(r"HUAWEI\s+FreeBuds\s+4E", label.strip(), re.IGNORECASE):
                    devices.append({"name": label, "address": normalize_address(name), "paired": True})
    except OSError as error:
        raise EarbudError("无法读取已配对耳机，请在 Windows 蓝牙设置检查连接", "enumeration_failed") from error
    return devices


class Connection:
    def __init__(self, address: str):
        self.address = normalize_address(address)
        self.sock = None
        self.decoder = Decoder()
        self.evidence = []

    def __enter__(self):
        if sys.platform != "win32" or not hasattr(socket, "AF_BLUETOOTH"):
            raise EarbudError("当前 Python/系统不支持 Windows 蓝牙控制", "unsupported_host")
        self.sock = socket.socket(socket.AF_BLUETOOTH, socket.SOCK_STREAM, socket.BTPROTO_RFCOMM)
        self.sock.settimeout(3)
        try:
            # FreeBuds 4E control channel, verified with product 0135 on Windows.
            self.sock.connect((self.address, 16))
            self.sock.settimeout(.4)
        except OSError as error:
            self.sock.close()
            raise EarbudError("耳机控制通道未连接。请取出耳机保持唤醒，并检查电脑蓝牙连接。", "disconnected") from error
        return self

    def __exit__(self, *_):
        if self.sock:
            self.sock.close()

    def query(self, command: bytes, parameters: dict, timeout=3):
        # Huawei frames have no request identifier. Never reuse a partial frame
        # or an already queued notification as this request's readback.
        self.decoder = Decoder()
        drain_deadline = time.monotonic() + .15
        self.sock.settimeout(.01)
        while True:
            if time.monotonic() >= drain_deadline:
                raise EarbudError("耳机状态通知繁忙，请稍后重试", "busy", self.evidence)
            try:
                stale = self.sock.recv(4096)
            except TimeoutError:
                break
            except OSError as error:
                raise EarbudError("耳机通信已断开", "disconnected", self.evidence) from error
            if not stale:
                raise EarbudError("耳机已断开，请唤醒后重试", "disconnected", self.evidence)
        payload = encode(command, parameters)
        self.evidence.append({"direction": "tx", "command": command.hex(), "frame": payload.hex()})
        self.sock.settimeout(min(.4, timeout))
        try:
            self.sock.sendall(payload)
        except OSError as error:
            raise EarbudError("耳机通信已断开", "disconnected", self.evidence) from error
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.sock.settimeout(max(.001, min(.4, deadline - time.monotonic())))
            try:
                data = self.sock.recv(4096)
            except TimeoutError:
                continue
            except OSError as error:
                raise EarbudError("耳机通信已断开", "disconnected", self.evidence) from error
            if not data:
                raise EarbudError("耳机已断开，请唤醒后重试", "disconnected", self.evidence)
            matched = None
            for frame in self.decoder.feed(data):
                # Retain only our status commands. Other notifications can carry
                # serial numbers or unrelated device data and are not evidence.
                if frame.command in {BATTERY, ANC_STATE, ANC_WRITE} and len(self.evidence) < 128:
                    self.evidence.append({"direction": "rx", "command": frame.command.hex(), "frame": frame.raw.hex()})
                if frame.command == command:
                    matched = frame
            if matched is not None:
                return matched
        raise EarbudError("耳机没有返回这项状态，请保持耳机唤醒后重试", "read_timeout", self.evidence)


@contextmanager
def device_lock(address):
    address = normalize_address(address)
    with _LOCKS_GUARD:
        lock = _LOCKS.setdefault(address, threading.Lock())
    if not lock.acquire(timeout=1):
        raise EarbudError("耳机正在执行上一项操作，请稍后重试", "busy")
    try:
        yield
    finally:
        lock.release()


def operate(address: str, mode: str | None = None, *, connector=Connection, enumerate_devices=list_devices) -> dict:
    address = normalize_address(address)
    if mode is not None and mode not in MODES:
        raise EarbudError("FreeBuds 4E 支持关闭、轻度和均衡降噪", "unsupported_mode")
    if address not in {device["address"] for device in enumerate_devices()}:
        raise EarbudError("请先在这台电脑配对 FreeBuds 4E，再选择对应耳机", "not_paired")
    with device_lock(address), connector(address) as channel:
        identity = device_identity(channel.query(INFO, {2: b"", 7: b""}))
        if not identity["supported"]:
            raise EarbudError("耳机身份未匹配 FreeBuds 4E；不会套用其他机型的控制指令", "unsupported_model")
        battery = battery_state(channel.query(BATTERY, {1: b"", 2: b"", 3: b""}))
        before = noise_state(channel.query(ANC_STATE, {1: b""}))
        result = {"status": "observed", "address": address, "identity": identity, "battery": battery,
                  "noise_mode": before, "supported_modes": list(MODES), "requested_mode": mode,
                  "write_verified": False, "physical_effect_verified": False}
        if mode is not None:
            try:
                ack = channel.query(ANC_WRITE, {1: MODES[mode]})
                ack_status = ack.parameters.get(2)
                if ack_status is None or len(ack_status) != 1:
                    raise EarbudError("耳机设置回执缺少有效状态", "invalid_ack", channel.evidence)
                if ack_status != b"\x00":
                    raise EarbudError("耳机没有确认这次降噪设置，未标记为成功", "write_rejected", channel.evidence)
                actual = noise_state(channel.query(ANC_STATE, {1: b""}))
            except EarbudError as error:
                # A lost ACK/readback cannot tell us that the write had no effect.
                # Keep the transport reason and do not automatically retry a write.
                if error.status != "write_rejected":
                    result.update(status="outcome_unknown", message="设置结果未知，耳机可能已经改变；请先刷新状态。",
                                  failure_reason=error.status, noise_mode=None, previous_mode=before,
                                  evidence=list(channel.evidence))
                    return result
                raise
            result.update(noise_mode=actual, previous_mode=before,
                          status="verified" if actual == mode else "unverified", write_verified=actual == mode)
        result["evidence"] = list(channel.evidence)
        return result
