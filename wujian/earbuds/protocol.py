"""Small Huawei 4E wire codec, independently implemented from public protocol evidence.

References and model restrictions are retained in PROTOCOL.md. A valid frame or write
ACK alone never proves the requested state: callers must request and compare readback.
"""

from __future__ import annotations

import binascii
from dataclasses import dataclass


BATTERY = b"\x01\x08"
INFO = b"\x01\x07"
ANC_STATE = b"\x2b\x2a"
ANC_WRITE = b"\x2b\x04"
MODES = {"off": b"\x00\x00", "light": b"\x01\x01", "balanced": b"\x01\x00"}


def encode(command: bytes, parameters: dict[int, bytes]) -> bytes:
    if len(command) != 2:
        raise ValueError("A Huawei command has two bytes")
    body = command + b"".join(bytes((key, len(value))) + value for key, value in parameters.items())
    prefix = b"Z" + (len(body) + 1).to_bytes(2, "big") + b"\x00" + body
    return prefix + binascii.crc_hqx(prefix, 0).to_bytes(2, "big")


@dataclass(frozen=True)
class Frame:
    command: bytes
    parameters: dict[int, bytes]
    raw: bytes


class Decoder:
    """Accept coalesced/fragmented RFCOMM data and resynchronise damaged frames."""

    def __init__(self):
        self.buffer = bytearray()

    def feed(self, data: bytes) -> list[Frame]:
        self.buffer.extend(data)
        frames = []
        while self.buffer:
            start = self.buffer.find(b"Z")
            if start < 0:
                self.buffer.clear()
                break
            del self.buffer[:start]
            if len(self.buffer) < 4:
                break
            length = int.from_bytes(self.buffer[1:3], "big")
            if not 3 <= length <= 2048 or self.buffer[3] != 0:
                del self.buffer[0]
                continue
            total = length + 5
            if len(self.buffer) < total:
                break
            raw = bytes(self.buffer[:total])
            if binascii.crc_hqx(raw[:-2], 0) != int.from_bytes(raw[-2:], "big"):
                del self.buffer[0]
                continue
            del self.buffer[:total]
            parameters, pos, valid = {}, 6, True
            while pos < total - 2:
                if pos + 2 > total - 2:
                    valid = False
                    break
                key, size = raw[pos:pos + 2]
                pos += 2
                if pos + size > total - 2 or key in parameters:
                    valid = False
                    break
                parameters[key] = raw[pos:pos + size]
                pos += size
            if valid:
                frames.append(Frame(raw[4:6], parameters, raw))
        return frames


def battery_state(frame: Frame) -> dict:
    if frame.command not in {BATTERY, b"\x01\x27"}:
        raise ValueError("Not a battery response")

    def percent(value):
        return value if 0 <= value <= 100 else None

    result = {"left": None, "right": None, "case": None, "combined": None}
    values = frame.parameters.get(2, b"")
    if len(values) == 3:
        result.update(zip(("left", "right", "case"), map(percent, values)))
        result["reported_levels"] = list(values)
        # Huawei uses zero for an unavailable earbud on this path. Without an
        # independent connection flag, displaying it as an empty battery lies.
        result["earbud_available"] = {side: value > 0 if value <= 100 else None
                                      for side, value in zip(("left", "right"), values)}
        for side in ("left", "right"):
            if result[side] == 0:
                result[side] = None
    combined = frame.parameters.get(1, b"")
    if len(combined) == 1:
        result["combined"] = percent(combined[0])
    return result


def noise_state(frame: Frame) -> str | None:
    if frame.command != ANC_STATE:
        return None
    # Read order is (level, mode); write order is (mode, level).
    value = frame.parameters.get(1, b"")
    if len(value) != 2:
        return None
    # The earbud retains its previous cancellation level when mode is off.
    # Actual 4E readback after light -> off is 01 00, not necessarily 00 00.
    if value[1] == 0:
        return "off"
    return {b"\x01\x01": "light", b"\x00\x01": "balanced"}.get(value)


def device_identity(frame: Frame) -> dict:
    model = frame.parameters.get(2, b"").hex() if frame.command == INFO else ""
    # 000135 / product 0135 is the documented FreeBuds 4E route. Name alone is
    # insufficient; other Huawei models assign different meanings to ANC bytes.
    return {
        "product_code": model,
        "supported": model == "0135",
        "firmware": frame.parameters.get(7, b"").decode("utf-8", "replace")[:100],
        "model": "HUAWEI FreeBuds 4E" if model == "0135" else "unknown",
    }
