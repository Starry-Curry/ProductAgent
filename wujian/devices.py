"""Project-local REA MCP transport, explicit targets and retained observations."""

import asyncio
import json
import shutil
from pathlib import Path
from urllib.parse import urlsplit

from agentscope.mcp import MCPClient, StdioMCPConfig
from sqlalchemy import select, update

from . import domain
from .config import ROOT
from .database import DeviceObservation, DeviceTarget, ItemRecord


def target_view(row):
    return {
        key: getattr(row, key)
        for key in ("id", "item_id", "kind", "address", "created_at")
    }


def owned_target(db, user_id, target_id):
    row = domain.require(db.get(DeviceTarget, target_id))
    if row.user_id != user_id:
        raise domain.DomainError("没有找到这个设备连接", 404)
    domain.accessible_item(db, user_id, row.item_id, write=True)
    return row


def artifact_path(address, roots):
    path = Path(address)
    if not path.is_absolute() or not path.exists():
        raise domain.DomainError("请提供确实存在的软件包或JavaScript应用绝对路径")
    resolved = path.resolve()
    if not any(
        resolved == root.resolve() or root.resolve() in resolved.parents
        for root in roots
    ):
        raise domain.DomainError(
            "请把待探索软件包放入var/device-artifacts，或在本地配置中指定已授权的软件目录"
        )
    if resolved.is_file() and resolved.suffix.lower() not in {
        ".asar",
        ".js",
        ".mjs",
        ".cjs",
    }:
        raise domain.DomainError(
            "此入口接受JavaScript或ASAR软件包；其他格式按实物目标接入"
        )
    return str(resolved)


def bind_target(db, user_id, item_id, kind, address, artifact_roots=None):
    domain.accessible_item(db, user_id, item_id, write=True)
    if kind == "browser_cdp":
        try:
            url = urlsplit(address)
            port = url.port
        except ValueError:
            raise domain.DomainError("浏览器调试连接地址或端口无效")
        if (
            url.scheme != "http"
            or url.hostname not in {"127.0.0.1", "localhost", "::1"}
            or not port
            or url.username
            or url.password
            or url.query
            or url.fragment
            or url.path not in {"", "/"}
        ):
            raise domain.DomainError(
                "浏览器连接需为本机明确端口的CDP地址，例如http://127.0.0.1:9222"
            )
        address = address.rstrip("/")
    elif kind == "javascript_artifact":
        address = artifact_path(
            address, artifact_roots or [ROOT / "var/device-artifacts"]
        )
    else:
        raise domain.DomainError(
            "当前可接入浏览器控制地址或JavaScript软件包；实机协议按目标扩展"
        )
    row = DeviceTarget(user_id=user_id, item_id=item_id, kind=kind, address=address)
    db.add(row)
    db.commit()
    return target_view(row)


class REABridge:
    def __init__(self, settings, sessions):
        self.settings, self.sessions = settings, sessions
        self.client = None
        self.catalog = {}
        self.lock = asyncio.Lock()

    async def connect(self):
        async with self.lock:
            if self.client and self.client.is_connected:
                return
            if not self.settings.rea_enabled:
                raise domain.DomainError("REA连接已在本地配置中关闭", 503)
            entry = Path(self.settings.rea_entry) if self.settings.rea_entry else None
            if entry is None:
                for candidate in (ROOT / "tmp/npm-cache/_npx").glob(
                    "*/node_modules/rea-agents/scripts/rea.mjs"
                ):
                    metadata = json.loads(
                        (candidate.parent.parent / "package.json").read_text(
                            encoding="utf-8"
                        )
                    )
                    if metadata.get("version") == "6.8.0":
                        entry = candidate
                        break
            if not entry or not entry.is_file():
                raise domain.DomainError(
                    "尚未找到项目内REA 6.8.0；请按README执行一次依赖准备", 503
                )
            node = shutil.which("node")
            if not node:
                raise domain.DomainError("需要可用的Node.js才能启动REA", 503)
            client = MCPClient(
                name="rea",
                is_stateful=True,
                mcp_config=StdioMCPConfig(
                    command=node, args=[str(entry.resolve()), "mcp"], cwd=ROOT
                ),
                execution_timeout=90,
            )
            try:
                await client.connect()
                catalog = await client.list_raw_tools()
            except Exception:
                await client.close()
                raise domain.DomainError("REA启动未成功；尚未连接设备", 503)
            self.client = client
            self.catalog = {tool.name: tool for tool in catalog}

    async def status(self, user_id, connect=False):
        error = ""
        if connect:
            try:
                await self.connect()
            except domain.DomainError as exc:
                error = exc.message
        with self.sessions() as db:
            targets = [
                target_view(row)
                for row in db.scalars(
                    select(DeviceTarget).where(DeviceTarget.user_id == user_id)
                )
                if db.get(ItemRecord, row.item_id).owner_id == user_id
            ]
        return {
            "bridge_connected": bool(self.client and self.client.is_connected),
            "tool_count": len(self.catalog),
            "targets": targets,
            "device_effect_verified": False,
            "error": error,
        }

    async def _invoke(self, name, arguments):
        await self.connect()
        if (
            name
            not in {
                "list_browser_targets",
                "analyze_javascript_application",
                "capture_browser_scenario",
            }
            or name not in self.catalog
        ):
            raise domain.DomainError("当前目标尚未接入此REA操作")
        tool = await self.client.get_tool(name)
        result = await tool(**arguments)
        return result.model_dump(mode="json")

    async def explore(self, user_id, target_id):
        with self.sessions() as db:
            target = owned_target(db, user_id, target_id)
            context = device_context(db,user_id,target)
            if target.kind == "browser_cdp":
                name, args = "list_browser_targets", {"cdp_endpoint": target.address}
            else:
                artifact_path(
                    target.address,
                    self.settings.rea_artifact_roots
                    or [self.settings.data_dir / "device-artifacts"],
                )
                name, args = (
                    "analyze_javascript_application",
                    {"input_path": target.address, "detail": "summary"},
                )
        evidence = await self._invoke(name, args)
        with self.sessions() as db:
            owned_target(db, user_id, target_id)
            row = DeviceObservation(
                target_id=target_id,
                user_id=user_id,
                tool=name,
                arguments=args,
                evidence={"tool_result":evidence,"item_context":context},
            )
            db.add(row)
            db.commit()
            return {
                "observation_id": row.id,
                "evidence": evidence,
                "item_context": context,
                "device_effect_verified": False,
            }

    async def propose(self, user_id, target_id, request):
        # Only exact, reviewable browser actions; no arbitrary shell, native attach or global active target.
        with self.sessions() as db:
            target = owned_target(db, user_id, target_id)
            browser = request.get("browser", {})
            if (
                target.kind != "browser_cdp"
                or browser.get("mode") != "connect"
                or browser.get("cdp_endpoint", "").rstrip("/") != target.address
            ):
                raise domain.DomainError(
                    "行动需绑定已登记的浏览器连接，不能悄悄更换控制目标"
                )
            if (
                not browser.get("target_id")
                or not request.get("actions")
                or not request.get("start_url", {}).get("url")
            ):
                raise domain.DomainError("需要选定实际页面、起始地址和具体动作")
            row = DeviceObservation(
                target_id=target_id,
                user_id=user_id,
                tool="capture_browser_scenario",
                arguments=request,
                evidence={"phase": "proposed", "device_effect_verified": False},
            )
            db.add(row)
            db.commit()
            return {
                "operation_id": row.id,
                "request": request,
                "phase": "proposed",
                "execution_requires_user_action": True,
            }

    async def execute(self, user_id, operation_id):
        with self.sessions() as db:
            row = domain.require(db.get(DeviceObservation, operation_id))
            if row.user_id != user_id:
                raise domain.DomainError("没有找到这项设备操作", 404)
            owned_target(db, user_id, row.target_id)
            if row.evidence.get("phase") != "proposed":
                raise domain.DomainError(
                    "此操作已尝试执行；请先检查实际结果，不自动重复执行", 409
                )
            previous = row.evidence
            changed = db.execute(
                update(DeviceObservation)
                .where(
                    DeviceObservation.id == row.id,
                    DeviceObservation.evidence == previous,
                )
                .values(
                    evidence={"phase": "executing", "device_effect_verified": False}
                )
            )
            if changed.rowcount != 1:
                raise domain.DomainError("此操作已被接续", 409)
            name, args = row.tool, row.arguments
            db.commit()
        try:
            evidence = await self._invoke(name, args)
            outcome = {
                "phase": "observed",
                "result": evidence,
                "device_effect_verified": False,
            }
        except BaseException:
            with self.sessions() as db:
                row = db.get(DeviceObservation, operation_id)
                row.evidence = {
                    "phase": "outcome_unknown",
                    "device_effect_verified": False,
                }
                db.commit()
            raise
        with self.sessions() as db:
            row = db.get(DeviceObservation, operation_id)
            row.evidence = outcome
            db.commit()
        return outcome

    async def close(self):
        if self.client:
            await self.client.close()


def device_context(db, user_id, target):
    from .foundation import known_claims
    item = domain.accessible_item(db,user_id,target.item_id,write=True)
    observations = db.scalars(select(DeviceObservation).where(
        DeviceObservation.user_id==user_id,DeviceObservation.target_id==target.id
    ).order_by(DeviceObservation.created_at.desc()).limit(5)).all()
    return {"item_id":item.id,"name":item.name,"product":item.product,"state":item.state,
        "item_version":item.version,"target":{"id":target.id,"kind":target.kind,"address":target.address},
        "knowledge":known_claims(db,user_id,item.id)[:12],
        "prior_observations":[{"id":row.id,"tool":row.tool,"created_at":row.created_at,
            "phase":row.evidence.get('phase','observation')} for row in observations],
        "control_effect_verified":False,
        "guidance":"复用仍适用的已有资料；仅询问缺失或变化的关键条件。具体型号不等于控制入口、协议和认证已确认。"}
