import asyncio
import io
import json
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from starlette.middleware.sessions import SessionMiddleware

from . import devices, domain, foundation, interactions
from .agent_runtime import AgentRunner
from .api_models import (
    ChatMessageView,
    ChatRequest,
    CommunitySessionView,
    ConversationView,
    DeviceBind,
    DeviceProposal,
    DeviceStatusView,
    DeviceTargetView,
    ExperienceCreate,
    ExperienceView,
    FriendRequest,
    FriendView,
    GiftCreate,
    GiftAccept,
    GiftView,
    HealthView,
    ItemChange,
    ItemCreate,
    ItemView,
    Login,
    MemoryView,
    Register,
    ReminderCreate,
    ReminderView,
    RunView,
    ShareRequest,
    TaskFeedback,
    TaskSave,
    TaskView,
    UserView,
)
from .config import ROOT, Settings
from .database import (
    Asset,
    ChatMessage,
    Conversation,
    DeviceObservation,
    ExperienceRecord,
    ExperienceShare,
    Friendship,
    Gift,
    Grant,
    HouseholdItem,
    HouseholdMember,
    ItemRecord,
    Reminder,
    Run,
    SourceRecord,
    TaskRecord,
    User,
    make_database,
    now,
    uid,
)
from .retrieval import task_view


class FrontendStaticFiles(StaticFiles):
    async def get_response(self,path,scope):
        response=await super().get_response(path,scope)
        if response.status_code==200 and path.lower().endswith('.mjs'):
            response.headers['content-type']='text/javascript; charset=utf-8'
        return response


def create_app(settings=None, model_factory=None):
    settings = settings or Settings.load()
    settings.prepare()
    engine, sessions = make_database(settings)
    runner = AgentRunner(settings, sessions, **({"model_factory": model_factory} if model_factory else {}))

    @asynccontextmanager
    async def lifespan(app):
        with sessions() as db:
            for run in db.scalars(select(Run).where(Run.status.in_(["queued", "running"]))):
                run.status, run.error = "interrupted", "服务重启，任务已停止。请继续对话；不会自动重复外部操作。"
            if settings.demo_mode:
                domain.seed_demo(db)
                from .interaction_demo import ensure_demo_workspace
                ensure_demo_workspace(db)
            db.commit()
        yield
        await runner.close()
        engine.dispose()

    app = FastAPI(title="物间 Wujian API", version="0.3.0", lifespan=lifespan)
    app.state.sessions, app.state.runner, app.state.settings = sessions, runner, settings
    app.add_middleware(SessionMiddleware, secret_key=settings.session_secret, same_site="lax", max_age=7 * 86400)

    @app.middleware("http")
    async def same_origin(request, call_next):
        origin = request.headers.get("origin")
        if request.method not in {"GET", "HEAD", "OPTIONS"} and origin and urlsplit(origin).netloc != request.headers.get("host"):
            return JSONResponse({"detail": "请求来源不匹配"}, status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(domain.DomainError)
    async def domain_error(request, error):
        return JSONResponse({"detail": error.message}, status_code=error.status)

    def db_session():
        with sessions() as db:
            yield db

    def current_user(request: Request, db=Depends(db_session)):
        user = db.get(User, request.session.get("user_id", ""))
        if user is None:
            raise domain.DomainError("请先登录", 401)
        return user

    @app.get("/api/health", response_model=HealthView)
    def health():
        return {"status": "ok", "model_configured": bool(settings.api_key), "model": settings.model,
                "demo_mode": settings.demo_mode, "device_connected": False}

    @app.post("/api/auth/register", response_model=UserView)
    def register(payload: Register, request: Request, db=Depends(db_session)):
        if db.scalar(select(User).where(User.username == payload.username)):
            raise domain.DomainError("用户名已被使用", 409)
        user = User(username=payload.username, display_name=payload.display_name, password_hash=domain.PASSWORDS.hash(payload.password))
        db.add(user)
        db.commit()
        request.session.clear()
        request.session["user_id"] = user.id
        return domain.user_view(user)

    @app.post("/api/auth/login", response_model=UserView)
    def login(payload: Login, request: Request, db=Depends(db_session)):
        user = db.scalar(select(User).where(User.username == payload.username))
        if user is None or not domain.PASSWORDS.verify(payload.password, user.password_hash):
            raise domain.DomainError("用户名或密码不正确", 401)
        request.session.clear()
        request.session["user_id"] = user.id
        return domain.user_view(user)

    @app.post("/api/auth/demo/{persona}", response_model=UserView)
    def demo_login(persona: str, request: Request, db=Depends(db_session)):
        if not settings.demo_mode:
            raise domain.DomainError("体验档案未开放", 404)
        identity = {"xiaolin": "person_demo_owner", "xiaoxia": "person_demo_friend"}.get(persona)
        family_username = {"mom": "xiaolin_mom_demo", "grandpa": "xiaolin_grandpa_demo"}.get(persona)
        user = domain.require(db.scalar(select(User).where(User.username == family_username)) if family_username
                              else db.get(User, identity or ""))
        request.session.clear()
        request.session["user_id"] = user.id
        return domain.user_view(user)

    @app.post("/api/auth/logout")
    async def logout(request: Request):
        user_id=request.session.get("user_id")
        # Failing to reclaim an external collector must not leave this app's
        # session authenticated. The manager retains any unreaped process.
        request.session.clear()
        if user_id:
            await runner.communities.close(user_id)
        return {"status": "ok"}

    @app.get("/api/me", response_model=UserView)
    def me(user=Depends(current_user)):
        return domain.user_view(user)

    @app.get("/api/items", response_model=list[ItemView])
    def items(query: str = "", user=Depends(current_user), db=Depends(db_session)):
        return domain.list_items(db, user.id, query)

    @app.post("/api/items", response_model=ItemView)
    def add_item(payload: ItemCreate, user=Depends(current_user), db=Depends(db_session)):
        return domain.create_item(db, user.id, payload)

    @app.get("/api/items/{item_id}", response_model=ItemView)
    def get_item(item_id: str, user=Depends(current_user), db=Depends(db_session)):
        return domain.item_view(db, user.id, domain.accessible_item(db, user.id, item_id))

    @app.put("/api/items/{item_id}", response_model=ItemView)
    def edit_item(item_id: str, payload: ItemChange, user=Depends(current_user), db=Depends(db_session)):
        return domain.change_item(db, user.id, item_id, payload)

    @app.post("/api/items/{item_id}/archive")
    def archive_item(item_id: str, user=Depends(current_user), db=Depends(db_session)):
        item = domain.accessible_item(db, user.id, item_id, write=True)
        item.archived, item.version = True, item.version + 1
        domain.invalidate_context(db, [user.id])
        db.commit()
        return {"status": "archived", "memories_preserved": True}

    @app.get("/api/items/{item_id}/shares")
    def shares(item_id: str, user=Depends(current_user), db=Depends(db_session)):
        domain.accessible_item(db, user.id, item_id, write=True)
        return [domain.user_view(db.get(User, identity)) for identity in db.scalars(select(Grant.user_id).where(Grant.item_id == item_id))]

    @app.post("/api/items/{item_id}/shares")
    def share(item_id: str, payload: ShareRequest, user=Depends(current_user), db=Depends(db_session)):
        domain.share_item(db, user.id, item_id, payload.user_id)
        return {"status": "shared"}

    @app.delete("/api/items/{item_id}/shares/{recipient_id}")
    def revoke(item_id: str, recipient_id: str, user=Depends(current_user), db=Depends(db_session)):
        domain.share_item(db, user.id, item_id, recipient_id, revoke=True)
        return {"status": "revoked"}

    @app.get("/api/experiences", response_model=list[ExperienceView])
    def experiences(item_id: str | None = None, query: str = "", user=Depends(current_user), db=Depends(db_session)):
        return domain.list_experiences(db, user.id, item_id, query)

    @app.post("/api/experiences", response_model=ExperienceView)
    def add_experience(payload: ExperienceCreate, user=Depends(current_user), db=Depends(db_session)):
        return domain.create_experience(db, user.id, payload)

    @app.get("/api/memories", response_model=list[MemoryView])
    def memories(user=Depends(current_user), db=Depends(db_session)):
        return domain.recall(db, user.id, limit=100)

    @app.delete("/api/memories/{memory_id}")
    def forget(memory_id: str, user=Depends(current_user), db=Depends(db_session)):
        domain.remove_memory(db, user.id, memory_id)
        return {"status": "removed"}

    @app.get("/api/conversations", response_model=list[ConversationView])
    def conversations(user=Depends(current_user), db=Depends(db_session)):
        return list(db.scalars(select(Conversation).where(Conversation.user_id == user.id).order_by(Conversation.updated_at.desc()).limit(80)))

    @app.get('/api/tasks',response_model=list[TaskView])
    def tasks(user=Depends(current_user),db=Depends(db_session)):
        return interactions.list_tasks(db, user.id)

    @app.post('/api/tasks',response_model=TaskView)
    def save_task(payload:TaskSave,user=Depends(current_user),db=Depends(db_session)):
        return foundation.save_task(db,user.id,'explicit_api',**payload.model_dump())

    @app.post('/api/tasks/{task_id}/feedback',response_model=TaskView)
    def feedback(task_id:str,payload:TaskFeedback,user=Depends(current_user),db=Depends(db_session)):
        return foundation.task_feedback(db,user.id,'explicit_api:'+uid(),task_id,**payload.model_dump())

    @app.get('/api/items/{item_id}/knowledge')
    def known_knowledge(item_id:str,user=Depends(current_user),db=Depends(db_session)):
        return foundation.known_claims(db,user.id,item_id)

    @app.get('/api/devices/status',response_model=DeviceStatusView)
    async def device_status(connect:bool=False,user=Depends(current_user)):
        return await runner.devices.status(user.id,connect)

    @app.post('/api/items/{item_id}/device',response_model=DeviceTargetView)
    def bind_device(item_id:str,payload:DeviceBind,user=Depends(current_user),db=Depends(db_session)):
        return devices.bind_target(db,user.id,item_id,payload.kind,payload.address,
                                   settings.rea_artifact_roots or [settings.data_dir/'device-artifacts'])

    @app.post('/api/devices/{target_id}/explore')
    async def explore_device(target_id:str,user=Depends(current_user)):
        return await runner.devices.explore(user.id,target_id)

    @app.post('/api/devices/{target_id}/proposals')
    async def propose_device(target_id:str,payload:DeviceProposal,user=Depends(current_user)):
        return await runner.devices.propose(user.id,target_id,payload.request)

    @app.get('/api/devices/operations/{operation_id}')
    def device_operation(operation_id:str,user=Depends(current_user),db=Depends(db_session)):
        row=domain.require(db.get(DeviceObservation,operation_id))
        if row.user_id!=user.id:
            raise domain.DomainError('没有找到这项操作',404)
        devices.owned_target(db,user.id,row.target_id)
        return {'id':row.id,'tool':row.tool,'arguments':row.arguments,'evidence':row.evidence}

    @app.post('/api/devices/operations/{operation_id}/execute')
    async def execute_device(operation_id:str,user=Depends(current_user)):
        return await runner.devices.execute(user.id,operation_id)

    def owned_conversation(db, user_id, conversation_id):
        row = domain.require(db.get(Conversation, conversation_id))
        if row.user_id != user_id:
            raise domain.DomainError("没有找到这段对话", 404)
        return row

    @app.get("/api/conversations/{conversation_id}/messages", response_model=list[ChatMessageView])
    def messages(conversation_id: str, user=Depends(current_user), db=Depends(db_session)):
        owned_conversation(db, user.id, conversation_id)
        return list(db.scalars(select(ChatMessage).where(ChatMessage.conversation_id == conversation_id).order_by(ChatMessage.created_at)))

    @app.post("/api/chat", response_model=RunView)
    async def chat(payload: ChatRequest, user=Depends(current_user), db=Depends(db_session)):
        if not settings.api_key:
            raise domain.DomainError("请在本地.env配置百炼API Key后启动对话", 503)
        if not payload.text.strip() and not payload.photo_ids:
            raise domain.DomainError("请写下一句话或添加照片")
        for identity in payload.item_ids:
            domain.accessible_item(db, user.id, identity)
        for identity in payload.photo_ids:
            asset = domain.own_asset(db, user.id, identity)
            if not asset.media_type.startswith("image/"):
                raise domain.DomainError("对话附件目前支持照片")
        conversation = owned_conversation(db, user.id, payload.conversation_id) if payload.conversation_id else Conversation(
            id=uid(), user_id=user.id, title=payload.text[:35] or "从一张照片开始")
        if not payload.conversation_id or "item_ids" in payload.model_fields_set:
            conversation.item_ids = payload.item_ids
        if payload.entry_context is not None:
            if payload.entry_context.task_id:
                interactions.task_access(db, user.id, payload.entry_context.task_id)
            conversation.entry_context = payload.entry_context.model_dump()
        if (conversation.entry_context or {}).get("intent") == "persona":
            if len(conversation.item_ids) != 1 or not domain.item_view(db, user.id,
                    domain.accessible_item(db, user.id, conversation.item_ids[0]))["avatar"].get("enabled"):
                raise domain.DomainError("请先为这件物品启用分身，或直接向物伴提问")
        conversation.updated_at = now()
        db.add(conversation)
        db.flush()
        run = Run(id=uid(), conversation_id=conversation.id, user_id=user.id)
        db.add(run)
        db.add(ChatMessage(conversation_id=conversation.id, role="user", text=payload.text, photo_ids=payload.photo_ids, run_id=run.id))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise domain.DomainError("这段对话已有进行中的任务，请等待或停止后继续", 409)
        runner.start(run.id)
        return RunView.model_validate(run, from_attributes=True)

    def owned_run(db, user_id, run_id):
        row = domain.require(db.get(Run, run_id))
        if row.user_id != user_id:
            raise domain.DomainError("没有找到这项任务", 404)
        return row

    from .api_models import GuidanceRequest, GuidanceFeedback, EntryContext
    @app.post('/api/guidance', response_model=RunView, tags=['Step-by-step guidance'])
    async def begin_guidance(payload: GuidanceRequest, user=Depends(current_user), db=Depends(db_session)):
        return await chat(ChatRequest(text=payload.question, item_ids=[payload.item_id],
            photo_ids=payload.photo_ids, entry_context=EntryContext(intent='guidance')),user,db)

    @app.post('/api/tasks/{task_id}/guidance-feedback', response_model=RunView, tags=['Step-by-step guidance'])
    async def guidance_feedback(task_id: str, payload: GuidanceFeedback, user=Depends(current_user), db=Depends(db_session)):
        from .guidance import start_feedback
        if not settings.api_key:
            raise domain.DomainError('请先配置百炼 API Key，反馈会由阿圆接着处理',503)
        run = start_feedback(db,user.id,task_id,payload)
        if run.status == 'queued':
            runner.start(run.id)
        return RunView.model_validate(run,from_attributes=True)

    @app.get("/api/runs/{run_id}", response_model=RunView)
    def run_status(run_id: str, user=Depends(current_user), db=Depends(db_session)):
        return owned_run(db, user.id, run_id)

    @app.get("/api/runs/{run_id}/events")
    async def run_events(run_id: str, user=Depends(current_user), db=Depends(db_session)):
        owned_run(db, user.id, run_id)
        async def stream():
            last = ""
            while True:
                with sessions() as session:
                    value = RunView.model_validate(owned_run(session, user.id, run_id), from_attributes=True).model_dump()
                serialized = json.dumps(value, ensure_ascii=False)
                if serialized != last:
                    yield "data: " + serialized + "\n\n"
                    last = serialized
                if value["status"] not in {"queued", "running"}:
                    break
                await asyncio.sleep(0.4)
        return StreamingResponse(stream(), media_type="text/event-stream")

    @app.post("/api/runs/{run_id}/cancel")
    def cancel(run_id: str, user=Depends(current_user), db=Depends(db_session)):
        run = owned_run(db, user.id, run_id)
        if run.status in {"queued", "running"}:
            run.status, run.error, run.updated_at = "interrupted", "任务已停止，已完成的记录会保留。", now()
            db.commit()
        runner.cancel(run_id)
        return {"status": "stopping"}

    @app.post("/api/assets")
    async def upload(file: UploadFile, user=Depends(current_user), db=Depends(db_session)):
        data = await file.read(10 * 1024 * 1024 + 1)
        if len(data) > 10 * 1024 * 1024:
            raise domain.DomainError("照片请控制在10MB以内")
        try:
            with Image.open(io.BytesIO(data)) as image:
                if image.width * image.height > 30_000_000:
                    raise domain.DomainError("照片尺寸过大，请压缩后上传")
                image = ImageOps.exif_transpose(image)
                if 'A' in image.getbands() or 'transparency' in image.info:
                    rgba=image.convert('RGBA')
                    image=Image.new('RGB',rgba.size,'white')
                    image.paste(rgba,mask=rgba.getchannel('A'))
                else:
                    image=image.convert('RGB')
                image.thumbnail((2000, 2000))
                output = io.BytesIO()
                image.save(output, "JPEG", quality=88)
                content = output.getvalue()
        except (UnidentifiedImageError, OSError):
            raise domain.DomainError("请选择可读取的照片")
        identity = uid()
        path = settings.data_dir / "assets" / identity
        path.write_bytes(content)
        db.add(Asset(id=identity, owner_id=user.id, path=str(path), media_type="image/jpeg", original_name=(file.filename or "照片")[:180]))
        db.commit()
        return {"id": identity, "url": "/api/assets/" + identity}

    @app.get("/api/assets/{asset_id}")
    def asset_file(asset_id: str, user=Depends(current_user), db=Depends(db_session)):
        asset = domain.require(db.get(Asset, asset_id))
        if asset.owner_id != user.id:
            item_allowed = False
            for item in db.scalars(select(ItemRecord).where(ItemRecord.photo_id == asset_id)):
                try:
                    domain.accessible_item(db, user.id, item.id)
                    item_allowed = True
                    break
                except domain.DomainError:
                    pass
            from .family_memory import ExperienceReadScope, can_read_experience
            story_allowed = False
            if not item_allowed:
                scope = ExperienceReadScope.load(db, user.id)
                story_allowed = any(asset_id in row.photo_ids and can_read_experience(db,user.id,row,scope=scope)
                    for row in db.scalars(select(ExperienceRecord).where(or_(
                        ExperienceRecord.household_id.in_(scope.members),
                        ExperienceRecord.id.in_(scope.shared_ids)))))
            gift_allowed = not (item_allowed or story_allowed) and any(asset_id == gift.snapshot.get("photo_id") or
                asset_id == gift.snapshot.get("avatar", {}).get("image_id") or
                any(asset_id in story.get("photo_ids",[]) for story in gift.snapshot.get("experiences",[]))
                for gift in db.scalars(select(Gift).where(Gift.status.in_(["pending","accepted"]),
                    or_(Gift.sender_id == user.id,Gift.recipient_id == user.id))))
            if not item_allowed and not story_allowed and not gift_allowed:
                raise domain.DomainError("没有找到这份文件", 404)
        return FileResponse(asset.path, media_type=asset.media_type,
                            filename=asset.original_name if not asset.media_type.startswith("image/") else None,
                            content_disposition_type="attachment", headers={"Cache-Control": "private, no-store"})

    @app.get("/api/friends", response_model=list[FriendView])
    def get_friends(user=Depends(current_user), db=Depends(db_session)):
        return domain.friends(db, user.id)

    @app.post("/api/friends")
    def add_friend(payload: FriendRequest, user=Depends(current_user), db=Depends(db_session)):
        other = domain.require(db.scalar(select(User).where(User.username == payload.username)), "未找到这个用户")
        if other.id == user.id:
            raise domain.DomainError("请选择另一位用户")
        if any(row["id"] == other.id for row in domain.friends(db, user.id)):
            return {"status": "already_requested"}
        db.add(Friendship(sender_id=user.id, recipient_id=other.id))
        db.commit()
        return {"status": "requested"}

    @app.post("/api/friends/{sender_id}/accept")
    def accept_friend(sender_id: str, user=Depends(current_user), db=Depends(db_session)):
        relation = domain.require(db.get(Friendship, (sender_id, user.id)))
        relation.accepted = True
        db.commit()
        return {"status": "accepted"}

    @app.get("/api/gifts", response_model=list[GiftView])
    def get_gifts(user=Depends(current_user), db=Depends(db_session)):
        return [domain.gift_view(db, row) for row in db.scalars(select(Gift).where(or_(Gift.sender_id == user.id, Gift.recipient_id == user.id)).order_by(Gift.created_at.desc()))]

    @app.post("/api/gifts", response_model=GiftView)
    def send_gift(payload: GiftCreate, user=Depends(current_user), db=Depends(db_session)):
        return domain.create_gift(db, user.id, payload)

    @app.post("/api/gifts/{gift_id}/accept", response_model=GiftView)
    def receive_gift(gift_id: str, payload: GiftAccept | None = None, user=Depends(current_user), db=Depends(db_session)):
        return domain.accept_gift(db, user.id, gift_id, acceptance=payload)

    @app.get("/api/reminders", response_model=list[ReminderView])
    def reminders(user=Depends(current_user), db=Depends(db_session)):
        return interactions.list_reminders(db, user.id)

    @app.post("/api/reminders")
    def add_reminder(payload: ReminderCreate, user=Depends(current_user), db=Depends(db_session)):
        from .butler_actions import create_reminder
        return create_reminder(db,user.id,payload)

    @app.post("/api/reminders/{reminder_id}/complete")
    def complete_reminder(reminder_id: str, user=Depends(current_user), db=Depends(db_session)):
        reminder = domain.require(db.get(Reminder, reminder_id))
        from .api_models import ReminderFeedback
        interactions.reminder_feedback(db, user.id, reminder_id,
            ReminderFeedback(expected_version=reminder.version, action="complete"))
        return {"status": "user_reported_complete"}

    @app.get("/api/sources")
    def sources(user=Depends(current_user), db=Depends(db_session)):
        return [{"id": row.id, "title": row.title, "url": row.url, "item_id": row.item_id, "fetched_at": row.fetched_at, "page_count": len(row.pages)}
                for row in db.scalars(select(SourceRecord).where(SourceRecord.owner_id == user.id))]

    from .interaction_routes import register_interactions
    register_interactions(app, current_user, db_session)
    from .butler_actions import register_routes as register_butler_routes
    register_butler_routes(app,current_user,db_session,settings)
    from .avatar_images import register_routes as register_avatar_images
    register_avatar_images(app,current_user,db_session,settings)
    from .earbuds import register_routes as register_earbud_routes
    register_earbud_routes(app,current_user,db_session,settings)
    from .coding_workbench import register_routes as register_coding_workbench
    register_coding_workbench(app,current_user,db_session,settings)
    from .community_reference_routes import register_reference_routes
    register_reference_routes(app,current_user,sessions,runner)
    from .photo_matching_routes import register_photo_matching
    register_photo_matching(app, current_user, settings, sessions)

    @app.get("/api/community/bilibili/session", response_model=CommunitySessionView)
    async def community_status(user=Depends(current_user)):
        return await runner.communities.status(user.id)

    @app.post("/api/community/bilibili/session", response_model=CommunitySessionView)
    async def community_start(user=Depends(current_user)):
        return await runner.communities.start(user.id)

    @app.delete("/api/community/bilibili/session", response_model=CommunitySessionView)
    async def community_close(user=Depends(current_user)):
        await runner.communities.close(user.id)
        return await runner.communities.status(user.id)
    from .teaching_diagram import register_diagrams
    from .camera_guidance import register_camera
    from .lesson_assets import register_pictures
    register_diagrams(app,current_user,db_session,settings)
    register_camera(app,current_user,db_session,settings)
    register_pictures(app,current_user,db_session,settings)
    dist = ROOT / "frontend" / "dist"
    if (dist / "assets").exists():
        app.mount("/assets", FrontendStaticFiles(directory=dist / "assets"), name="frontend_assets")
    if (dist / "illustrations").exists():
        app.mount("/illustrations", StaticFiles(directory=dist / "illustrations"), name="illustrations")

    @app.get("/", include_in_schema=False)
    def index():
        if (dist / "index.html").exists():
            return FileResponse(dist / "index.html")
        return JSONResponse({"message": "后端已启动。请构建frontend后刷新。", "api_docs": "/docs"})

    return app
