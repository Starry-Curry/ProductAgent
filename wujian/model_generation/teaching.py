"""Attach generated exterior models through the existing task/asset writers."""
import shutil
from pathlib import Path

from .. import domain, foundation, interactions
from ..database import Asset, now, uid
from ..guidance import step_signature
from ..source_access import readable_source
from .service import GenerationError, generate_model
from .assets import inspect_glb


def input_photos(db, user_id, item, payload):
    identities = list(payload.photo_ids or ([item.photo_id] if item.photo_id else []))
    for identity in identities:
        # Explicit uploads must belong to the caller. Item photo access follows the existing item grant.
        asset = domain.own_asset(db, user_id, identity) if identity in payload.photo_ids else db.get(Asset, identity)
        if asset is None or not asset.media_type.startswith('image/'):
            raise domain.DomainError('请使用可读取的实物照片', 409)
    return identities


async def generate_for_step(settings, db, user_id, task_id, payload):
    from ..teaching_diagram import teaching_step
    task, entry = teaching_step(db, user_id, task_id, payload)
    item_id = entry.get('item_id') or next(iter(task.item_ids), None)
    if not item_id:
        raise domain.DomainError('先关联正在处理的实物', 409)
    item = domain.accessible_item(db, user_id, item_id)
    identities = input_photos(db, user_id, item, payload)
    if not identities:
        raise domain.DomainError('请先提供一张物品照片，再生成外观模型', 409)
    for evidence in entry['guidance']['evidence']:
        readable_source(db, user_id, evidence['source_id'])
    signature = step_signature(entry)
    # Only the first selected photo conditions geometry; remaining photos are reference evidence.
    image = domain.require(db.get(Asset, identities[0])).path
    raw = Path(image).read_bytes()
    import hashlib
    photo_sha = hashlib.sha256(raw).hexdigest()
    cached = task.plan.get('visualizations', {}).get(payload.step_id)
    if cached and cached.get('mesh') and (not payload.local_only or cached['mesh'].get('fallback')) and cached.get('step_signature') == signature and cached.get('photo_ids') == identities and cached['mesh'].get('source_sha256') == photo_sha:
        model = domain.own_asset(db, user_id, cached['mesh']['asset_id'])
        try:
            if inspect_glb(Path(model.path))['sha256'] == cached['mesh']['sha256']:
                return interactions.board(db, user_id, task_id)
        except (OSError, ValueError, TypeError, KeyError):
            pass  # Reattach a verified generation receipt rather than reusing a broken asset.
    db.commit()
    try:
        result = await generate_model(settings, user_id, raw, local_only=payload.local_only)
    except GenerationError as error:
        raise domain.DomainError(str(error), 503) from None
    db.expire_all()
    task, entry = teaching_step(db, user_id, task_id, payload)
    item = domain.accessible_item(db, user_id, item_id)
    if input_photos(db, user_id, item, payload) != identities or hashlib.sha256(Path(domain.require(db.get(Asset, identities[0])).path).read_bytes()).hexdigest() != photo_sha or step_signature(entry) != signature:
        raise domain.DomainError('照片或步骤已经变化，请刷新后重试', 409)
    for evidence in entry['guidance']['evidence']:
        readable_source(db, user_id, evidence['source_id'])
    identity = uid()
    destination = settings.data_dir / 'assets' / identity
    shutil.copyfile(result['path'], destination)
    db.add(Asset(id=identity, owner_id=user_id, path=str(destination.resolve()),
                 media_type='model/gltf-binary', original_name='generated-exterior.glb'))
    scene = {'title': entry['title'], 'parts': [], 'focus_ids': [], 'movement': [0, 0, 0], 'turns': 0,
             'action': 'observe', 'explanation': entry['guidance'].get('instruction', entry['title']),
             'uncertainty': '照片生成的外观示意；未拍到的面由模型补全，按键与接口可能失真。指示位置需与实物核对，不代表已完成操作。'}
    saved = {'schema': 'schematic/1', 'scene': scene, 'step_signature': signature,
             'nature': 'model_generated_exterior', 'photo_ids': identities,
             'evidence': entry['guidance']['evidence'], 'created_at': now(),
             'mesh': {'asset_id': identity, 'sha256': result['geometry']['sha256'],
                      'faces': result['geometry']['faces'], 'provider': result['provider'],
                      'model': result['model'], 'source_sha256': photo_sha,
                      'fallback': result['provider'] == 'local/hunyuan-mini',
                      'textured': result['provider'] == 'aliyun-bailian/tripo',
                      'attempts': result['attempts'], 'physical_operation_verified': False}}
    try:
        foundation.save_task(db, user_id, task.source_message_id, task.goal, task.item_ids,
                             task.constraints, {**task.plan, 'visualizations': {
                                 **task.plan.get('visualizations', {}), payload.step_id: saved}},
                             task.id, payload.expected_version, task.status)
    except Exception:
        db.rollback()
        destination.unlink(missing_ok=True)
        raise
    return interactions.board(db, user_id, task_id)
