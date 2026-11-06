"""Source-bound step pictures. Coordinates are on the displayed crop, never video paths."""
import copy
import math
import base64
import io

from . import domain


def checked_picture(db,user_id,picture):
    value=copy.deepcopy(picture)
    domain.own_asset(db,user_id,value['image_id'])
    for field in ['box','point']:
        if field not in value:continue
        numbers=value[field]
        if len(numbers)!=(4 if field=='box' else 2) or any(not isinstance(n,(int,float)) or not math.isfinite(n) or not 0<=n<=1000 for n in numbers):
            raise domain.DomainError('图片标注坐标不合法')
    if 'box' in value and (value['box'][2]<=value['box'][0] or value['box'][3]<=value['box'][1]):
        raise domain.DomainError('图片标注区域不合法')
    value['evidence_kind']='reviewed_photo_annotation'
    return value


def step_pictures(db,user_id,item,package):
    assets=item.state.get('teaching',{}).get('picture_assets',{})
    result={}
    for step in package['steps']:
        spec=step.get('picture')
        if not spec or not assets.get(spec['asset_key']):continue
        result[step['id']]=checked_picture(db,user_id,{**spec,'image_id':assets[spec['asset_key']],
            'manual_page_id':assets.get('manual_'+str(step['manual_pdf_page'])),
            'manual_pdf_page':step['manual_pdf_page'],'basis':'用户实拍；按官网 HPA01 手册校核位置。箭头为人工校核标注，不表示操作已完成。'})
    return result


def register_pictures(app,current_user,db_session,settings):
    """Reuse an already-read manual page or owned photo, with honest grounding.

    Web lookup stays in the main Agent search/fetch tools; no guessed image URLs.
    """
    from fastapi import Depends
    from PIL import Image,ImageOps
    from .teaching_diagram import DiagramRequest,teaching_step
    from .knowledge import render_source_page
    from . import camera_guidance
    from .database import Asset,uid
    from .guidance import step_signature
    from .source_access import readable_source
    from .api_models import TaskBoardView
    from . import foundation,interactions

    @app.post('/api/tasks/{task_id}/picture',response_model=TaskBoardView,tags=['Teaching pictures'])
    async def picture(task_id:str,payload:DiagramRequest,user=Depends(current_user),db=Depends(db_session)):
        task,entry=teaching_step(db,user.id,task_id,payload)
        cached=task.plan.get('guidance',{}).get('pictures',{}).get(entry['id'])
        if cached and (cached.get('evidence_kind')=='reviewed_photo_annotation' or cached.get('step_signature')==step_signature(entry)):
            domain.own_asset(db,user.id,cached['image_id'])
            return interactions.board(db,user.id,task.id)
        item=domain.accessible_item(db,user.id,entry.get('item_id') or task.item_ids[0])
        image_id=next(iter(reversed(payload.photo_ids)),None) or item.photo_id
        source_id=None;page_number=None
        if not payload.photo_ids:
            for evidence in entry['guidance'].get('evidence',[]):
                source=readable_source(db,user.id,evidence['source_id'])
                if not source.asset_id or source.owner_id!=user.id:continue
                asset=domain.own_asset(db,user.id,source.asset_id)
                if asset.media_type!='application/pdf':continue
                page=evidence.get('page') or 1
                encoded=render_source_page(settings,source,asset,page)
                identity=uid();path=settings.data_dir/'assets'/identity;path.write_bytes(base64.b64decode(encoded))
                db.add(Asset(id=identity,owner_id=user.id,path=str(path.resolve()),media_type='image/png',original_name='manual-page.png'));db.flush()
                image_id=identity;source_id=source.id;page_number=page;break
        if not image_id:raise domain.DomainError('尚无实物照片或已读取的说明书页，可以先拍一张',409)
        asset=domain.own_asset(db,user.id,image_id)
        if not asset.media_type.startswith('image/'):raise domain.DomainError('位置图需要照片或说明书页图')
        with Image.open(asset.path) as raw:
            image=ImageOps.exif_transpose(raw).convert('RGB');image.thumbnail((1280,1280));buffer=io.BytesIO();image.save(buffer,'JPEG',quality=90)
        signature=step_signature(entry);target={'name':item.name,'model':item.product.get('model',''),
            'target':entry['guidance'].get('target_label') or entry['title'],'instruction':entry['guidance']['instruction']}
        db.commit()
        answer=None;grounding_error=None
        if settings.api_key:
            try:answer=await camera_guidance.locate(settings,base64.b64encode(buffer.getvalue()).decode(),target)
            except Exception as error:grounding_error=type(error).__name__
        db.expire_all();task,entry=teaching_step(db,user.id,task_id,payload)
        domain.own_asset(db,user.id,image_id)
        if source_id:readable_source(db,user.id,source_id)
        if step_signature(entry)!=signature:raise domain.DomainError('步骤刚更新，请查看新的位置图',409)
        value={'image_id':image_id,'label':answer.label if answer and answer.visible else '位置尚未核对，请结合文字看图',
            'step_signature':signature,'source_id':source_id,'manual_pdf_page':page_number,
            'basis':'已读取的说明书页' if source_id else '物品实拍照片',
            'evidence_kind':'model_grounding_on_static_image' if answer and answer.visible else 'unannotated_source_image',
            'model':settings.vision_model if answer else None,'grounding_error':grounding_error}
        if answer and answer.visible and answer.confidence>=.65 and answer.bbox:
            value['point']=[(answer.bbox[0]+answer.bbox[2])/2/999*1000,(answer.bbox[1]+answer.bbox[3])/2/999*1000]
        progress=task.plan.get('guidance',{});pictures={**progress.get('pictures',{}),entry['id']:value}
        foundation.save_task(db,user.id,task.source_message_id,task.goal,task.item_ids,task.constraints,
            {**task.plan,'guidance':{**progress,'pictures':pictures}},task.id,payload.expected_version,task.status)
        return interactions.board(db,user.id,task.id)
