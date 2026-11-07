"""User-scoped earbud operations; the HTTP UI and main Agent use this same facade."""

from __future__ import annotations

import re
import threading
from typing import Literal

from fastapi import Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from .. import domain
from ..database import DeviceObservation, DeviceTarget, ItemRecord
from . import windows
from .audio import operate_volume

KIND = "bluetooth_freebuds4e"
_CONSOLE_LOCK = threading.Lock()


class ConsoleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    address: str | None = Field(default=None, max_length=32)


class NoiseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["off", "light", "balanced"]


class VolumeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    volume: float = Field(ge=0, le=100, allow_inf_nan=False, strict=True)
    endpoint_id: str = Field(min_length=1, max_length=200)


class EarbudResult(BaseModel):
    status: str
    message: str = ""
    item_id: str | None = None
    target_id: str | None = None
    console_url: str | None = None
    observed_at: str | None = None
    observation_id: str | None = None
    devices: list[dict] = Field(default_factory=list)
    state: dict | None = None
    available: bool = False
    physical_effect_verified: bool = False


def _target(db, user_id, item_id):
    domain.accessible_item(db, user_id, item_id, write=True)
    return db.scalar(select(DeviceTarget).where(DeviceTarget.user_id == user_id,
                     DeviceTarget.item_id == item_id, DeviceTarget.kind == KIND).order_by(DeviceTarget.created_at.desc()))


def _result(target, observation=None):
    return {
        "status": observation.evidence.get("status", "ready") if observation else "ready",
        "item_id": target.item_id, "target_id": target.id,
        "console_url": f"/#items?item={target.item_id}&panel=earbuds",
        "available": bool(observation and observation.evidence.get("status") in {"observed", "verified", "unverified"}),
        "observed_at": observation.created_at if observation else None,
        "observation_id": observation.id if observation else None,
        "state": observation.evidence if observation else None,
        "physical_effect_verified": False,
    }


def _observe(db, user_id, target, mode=None, *, audio=False, volume=None, endpoint_id=None):
    try:
        state = operate_volume(target.address, volume, endpoint_id=endpoint_id) if audio else windows.operate(target.address, mode)
    except windows.EarbudError as error:
        state = {"status": error.status, "message": str(error), "write_verified": False,
                 "requested_mode": mode, "physical_effect_verified": False, "evidence": error.evidence}
    except OSError:
        state = {"status": "connection_error", "message": "耳机通信中断，请检查蓝牙后重试",
                 "write_verified": False, "requested_mode": mode, "physical_effect_verified": False}
    tool = ("set_earbud_output_volume" if volume is not None else "read_earbud_output_volume") if audio else (
        "set_earbud_noise_mode" if mode is not None else "read_earbuds")
    arguments = {"volume": volume, "endpoint_id": endpoint_id} if audio and volume is not None else (
        {"mode": mode} if mode is not None else {})
    observation = DeviceObservation(target_id=target.id, user_id=user_id,
        tool=tool, arguments=arguments, evidence=state)
    db.add(observation)
    db.commit()
    response = _result(target, observation)
    response["available"] = state["status"] in {"observed", "verified", "unverified"}
    if audio:
        message = "已读取 Windows 耳机输出端点音量" if volume is None else (
            "Windows 输出音量已回读确认" if state.get("write_verified") else "音量设置尚未确认，请刷新状态")
    else:
        message = "已读取耳机回执" if mode is None else (
            "耳机已回读确认设置" if state.get("write_verified") else "设置尚未确认，请刷新状态")
    response["message"] = state.get("message", message)
    return response


def earbud_tool(db, user_id: str, operation: str, item_id: str | None = None,
                address: str | None = None, mode: str | None = None,
                volume: float | None = None, endpoint_id: str | None = None) -> dict:
    """Exact operations: inspect/read/create_console/set_anc/status/read_volume/set_volume.

    `create_console` binds an owned Wujian item to a real, paired and protocol-
    identified 4E, then configures the existing native connector and UI. It does
    not promise arbitrary shell/code-execution permission. `set_anc` requires
    caller-side current-turn user authorization in addition to this ownership
    check; it never silently creates a new binding.
    `set_volume` likewise requires current user intent and a freshly observed
    endpoint_id. It controls only the bound Windows playback endpoint.
    """
    if operation == "inspect":
        try:
            return {"status": "paired_devices", "available": True, "devices": windows.list_devices(),
                    "message": "已配对记录不等于当前控制通道在线；创建工作台会实测连接。"}
        except windows.EarbudError as error:
            return {"status": error.status, "available": False, "message": str(error)}
    if operation not in {"read", "status", "create_console", "set_anc", "read_volume", "set_volume"}:
        raise domain.DomainError("不支持的耳机操作")
    if not item_id:
        raise domain.DomainError("请指定物间中对应的耳机物品")
    target = _target(db, user_id, item_id)
    if operation == "create_console":
        # Hold through SQL commit: two simultaneous requests must not create
        # duplicate bindings while the device-level transport lock is released.
        if not _CONSOLE_LOCK.acquire(timeout=1):
            return {"status": "busy", "item_id": item_id, "available": False,
                    "message": "正在配置耳机工作台，请稍后重试"}
        try:
            return _create_console(db, user_id, item_id, address)
        finally:
            _CONSOLE_LOCK.release()
    if not target:
        return {"status": "not_bound", "item_id": item_id, "available": False,
                "message": "这件耳机还未连接工作台，请先创建耳机工作台。"}
    if operation == "status":
        latest = db.scalar(select(DeviceObservation).where(DeviceObservation.target_id == target.id,
            DeviceObservation.user_id == user_id).order_by(DeviceObservation.created_at.desc()))
        return {**_result(target, latest), "available": False,
                "message": "这是上次读取记录；刷新后确认耳机当前连接和状态。"}
    if operation == "set_anc":
        if mode not in windows.MODES:
            raise domain.DomainError("请指定 off、light 或 balanced 降噪模式")
        return _observe(db, user_id, target, mode)
    if operation in {"read_volume", "set_volume"}:
        if operation == "set_volume" and volume is None:
            raise domain.DomainError("请指定 Windows 耳机输出音量")
        return _observe(db, user_id, target, audio=True,
                        volume=volume if operation == "set_volume" else None, endpoint_id=endpoint_id)
    return _observe(db, user_id, target)


def _create_console(db, user_id, item_id, address):
    target = _target(db, user_id, item_id)
    item = domain.accessible_item(db, user_id, item_id, write=True)
    identity_text = str(item.product) + " " + item.name
    if "huawei" not in identity_text.lower() and "华为" not in identity_text:
        raise domain.DomainError("请先把这件物品的品牌/型号设置为华为 FreeBuds 4E")
    if not re.search(r"\bfreebuds\s*4e\b", identity_text, re.IGNORECASE):
        raise domain.DomainError("此工作台当前适配 FreeBuds 4E，请核对物品型号")
    try:
        candidates = windows.list_devices()
        if address:
            chosen = windows.normalize_address(address)
            candidates = [device for device in candidates if device["address"] == chosen]
        elif target:
            candidates = [device for device in candidates if device["address"] == target.address]
        if not candidates:
            raise windows.EarbudError("未发现对应的已配对 FreeBuds 4E，请在 Windows 设置中连接", "not_paired")
        if len(candidates) != 1:
            raise windows.EarbudError("发现多台已配对耳机，请明确选择这件实物对应的蓝牙地址", "ambiguous_target")
        existing = db.scalars(select(DeviceTarget).where(DeviceTarget.kind == KIND,
            DeviceTarget.address == candidates[0]["address"], DeviceTarget.item_id != item_id)).all()
        if any((bound_item := db.get(ItemRecord, binding.item_id)) is not None
               and bound_item.owner_id == binding.user_id for binding in existing):
            raise windows.EarbudError("这台耳机已绑定另一件物品，不能重复认领设备", "already_bound")
        chosen_state = windows.operate(candidates[0]["address"])
    except windows.EarbudError as error:
        return {"status": error.status, "item_id": item_id, "available": False, "message": str(error)}
    except OSError:
        return {"status": "connection_error", "item_id": item_id, "available": False,
                "message": "耳机通信中断，请检查蓝牙后重试"}
    if not target:
        target = DeviceTarget(user_id=user_id, item_id=item_id, kind=KIND, address=chosen_state["address"])
        db.add(target)
        db.flush()
    elif target.address != chosen_state["address"]:
        target.address = chosen_state["address"]
    observation = DeviceObservation(target_id=target.id, user_id=user_id, tool="create_earbud_console",
        arguments={"item_id": item_id}, evidence=chosen_state)
    db.add(observation)
    db.commit()
    return {**_result(target, observation), "message": "耳机工作台已配置，电量和降噪来自实际设备回读。"}


def register_routes(app, current_user, db_session, settings=None):
    def enabled():
        if settings is not None and not settings.rea_enabled:
            raise domain.DomainError("设备连接器未启用", 403)

    requirements = [Depends(enabled)]

    @app.get("/api/earbuds/devices", response_model=EarbudResult, dependencies=requirements)
    def inspect(user=Depends(current_user), db=Depends(db_session)):
        return earbud_tool(db, user.id, "inspect")

    @app.get("/api/items/{item_id}/earbuds", response_model=EarbudResult, dependencies=requirements)
    def status(item_id: str, user=Depends(current_user), db=Depends(db_session)):
        return earbud_tool(db, user.id, "status", item_id)

    @app.post("/api/items/{item_id}/earbuds/console", response_model=EarbudResult, dependencies=requirements)
    def create(item_id: str, payload: ConsoleRequest, user=Depends(current_user), db=Depends(db_session)):
        return earbud_tool(db, user.id, "create_console", item_id, payload.address)

    @app.post("/api/items/{item_id}/earbuds/read", response_model=EarbudResult, dependencies=requirements)
    def read(item_id: str, user=Depends(current_user), db=Depends(db_session)):
        return earbud_tool(db, user.id, "read", item_id)

    @app.post("/api/items/{item_id}/earbuds/noise-mode", response_model=EarbudResult, dependencies=requirements)
    def set_mode(item_id: str, payload: NoiseRequest, user=Depends(current_user), db=Depends(db_session)):
        return earbud_tool(db, user.id, "set_anc", item_id, mode=payload.mode)

    @app.post("/api/items/{item_id}/earbuds/volume/read", response_model=EarbudResult, dependencies=requirements)
    def read_volume(item_id: str, user=Depends(current_user), db=Depends(db_session)):
        return earbud_tool(db, user.id, "read_volume", item_id)

    @app.post("/api/items/{item_id}/earbuds/volume", response_model=EarbudResult, dependencies=requirements)
    def set_volume(item_id: str, payload: VolumeRequest, user=Depends(current_user), db=Depends(db_session)):
        return earbud_tool(db, user.id, "set_volume", item_id, volume=payload.volume, endpoint_id=payload.endpoint_id)
