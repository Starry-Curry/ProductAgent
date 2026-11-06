"""Create or append an AS2 teaching item from local photos/video and a real PDF.

No paid calls. Instructions are reviewed paraphrases, not extracted PDF text.
Existing databases are preserved. The optional --clean-profile creates a fresh
single-object demonstration profile, never deletes an existing one.
"""
import argparse,hashlib,json,shutil,sys,subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from sqlalchemy import select
from wujian import domain
from wujian.api_models import ItemCreate
from wujian.config import Settings
from wujian.database import Asset,SourceRecord,User,make_database,uid
from wujian.lessons import package_for


def seed(settings,media_dir,manual,clean=False,prepare_video=True):
    settings.prepare();engine,sessions=make_database(settings)
    marker=settings.data_dir/'as2-demo-manifest.json'
    if marker.exists():return json.loads(marker.read_text(encoding='utf-8'))
    with sessions() as db:
        if clean:
            if db.scalar(select(User.id).limit(1)):raise ValueError('Clean profile requires a new database; existing users are preserved')
            db.add(User(id='person_demo_owner',username='xiaolin',display_name='小林',
                password_hash=domain.PASSWORDS.hash(uid()),preferences={}));db.commit()
        else:domain.seed_demo(db)
        owner='person_demo_owner'
        def asset(path,media_type):
            identity=uid();destination=settings.data_dir/'assets'/identity;shutil.copyfile(path,destination)
            db.add(Asset(id=identity,owner_id=owner,path=str(destination.resolve()),media_type=media_type,original_name=path.name));db.commit()
            return identity
        photo=asset(media_dir/'pic/1.jpg','image/jpeg')
        video=asset(media_dir/'pic/movie.mp4','video/mp4')
        original_video=video
        if prepare_video and shutil.which('ffmpeg'):
            prepared=settings.data_dir/'prepared';prepared.mkdir(exist_ok=True)
            preview=prepared/'as2-browser.mp4'
            subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(media_dir/'pic/movie.mp4'),
                '-an','-c:v','libx264','-preset','fast','-crf','21','-pix_fmt','yuv420p','-movflags','+faststart',str(preview)],
                check=True,creationflags=0x08000000 if sys.platform=='win32' else 0)
            video=asset(preview,'video/mp4')
        panel=asset(media_dir/'pic/5.jpg','image/jpeg')
        manual_asset=asset(manual,'application/pdf')
        item=domain.create_item(db,owner,ItemCreate(name='我的 LOKLiK AS2 烫印机',kind='standard_product',photo_id=photo,
            product={'brand':'LOKLiK','model':'AS2','edition':'HPA01 / 中国大陆 220V 实体按键版',
                'source_urls':['https://www.loklik.cn/printing-machine-as2/','https://www.loklik.cn/files-download/']},
            description='用户提供的实拍 AS2。教学资料来自大陆官网 HPA01 说明书；示意模型为 Codex 按实拍制作，不是精确CAD。',
            state={'teaching':{'package_id':'loklik-as2','video_id':video,'panel_photo_id':panel}}))
        row=domain.accessible_item(db,owner,item['id'])
        from scripts.prepare_as2_pictures import prepare_pictures
        pictures=prepare_pictures(media_dir,manual,settings.data_dir/'prepared',asset)
        row.state={**row.state,'teaching':{**row.state['teaching'],'picture_assets':pictures}}
        reference=json.loads((ROOT/'fixtures/teaching/loklik-as2-reference.json').read_text(encoding='utf-8'))
        if shutil.which('ffmpeg') and hashlib.sha256((media_dir/'pic/movie.mp4').read_bytes()).hexdigest()==reference['video_sha256']:
            prepared=settings.data_dir/'prepared';prepared.mkdir(exist_ok=True)
            image=prepared/'as2-reference.png'
            subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-ss','0','-i',str(media_dir/'pic/movie.mp4'),
                '-frames:v','1','-vf',f"scale={reference['width']}:{reference['height']}",str(image)],check=True,creationflags=0x08000000 if sys.platform=='win32' else 0)
            reference['image_id']=asset(image,'image/png');reference['image_sha256']=hashlib.sha256(image.read_bytes()).hexdigest()
            row.state={**row.state,'teaching':{**row.state['teaching'],'reference':reference}}
        package=package_for(row)
        original=SourceRecord(id=uid(),owner_id=owner,item_id=row.id,origin='public_web',title='LOKLiK AS2 HPA01 中国大陆原始说明书 PDF',
            url=package['manual']['url'],asset_id=manual_asset,
            content='官方 AS2 HPA01 原始PDF：文字为转曲，抽取为空。请用原始页图核对；不能把导览改写当作原文。',
            pages=[{'page':i,'text':''} for i in range(1,7)])
        guide=SourceRecord(id=uid(),owner_id=owner,item_id=row.id,origin='reviewed_guide',title='AS2 按实拍与官网手册校核的操作导览（改写，非原文）',
            url=package['manual']['index_url'],content='LOKLiK AS2 / HPA01 220V 实体按键版。以下是Codex逐页核对后编写的操作导览，不是PDF逐字转录。\n'
                +'\n'.join(step['reviewed_instruction'] for step in package['steps']),pages=[])
        db.add_all([original,guide]);db.flush()
        row.state={**row.state,'teaching':{**row.state['teaching'],'source_id':guide.id,'manual_source_id':original.id,
            'manual_asset_id':manual_asset,'manual_sha256':hashlib.sha256(manual.read_bytes()).hexdigest()}}
        db.commit()
        manifest={'item_id':row.id,'photo_id':photo,'panel_photo_id':panel,'video_id':video,'original_video_id':original_video,'manual_asset_id':manual_asset,
            'source_id':guide.id,'manual_source_id':original.id,'data_dir':str(settings.data_dir.resolve()),
            'physical_operation_verified':False,'media_origin':'User-supplied AS2 photos and 18.23 second real video',
            'start_text':'我不知道这台烫印机怎么用，请带我一步一步来。',
            'route':'/#items?item='+row.id,'package_id':package['id']}
        marker.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    engine.dispose();return manifest


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir',type=Path,required=True);parser.add_argument('--media-dir',type=Path,default=ROOT/'data/realdemo/LOKLiK_AS2')
    parser.add_argument('--manual',type=Path,required=True);parser.add_argument('--clean-profile',action='store_true')
    args=parser.parse_args()
    settings=Settings(data_dir=args.data_dir,rea_enabled=False)
    print(json.dumps(seed(settings,args.media_dir,args.manual,args.clean_profile),ensure_ascii=False,indent=2))
