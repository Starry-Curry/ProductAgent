"""Synthetic ownership + real IKEA photograph; no paid model calls."""
import argparse
import asyncio
import json
import mimetypes
import shutil
import sys
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from wujian import foundation
from wujian.config import ROOT,Settings
from wujian.database import Asset,uid
from wujian.knowledge import download_public
from wujian.server import create_app

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--data-dir',type=Path,default=ROOT/'tmp/a-camera-review')
parser.add_argument('--video-file',type=Path)
parser.add_argument('--append-demo',action='store_true')
args=parser.parse_args()
marker=args.data_dir/'demo-manifest.json'
if (args.data_dir/'wujian.sqlite3').exists():
    if not args.append_demo or not marker.exists() or not json.loads(marker.read_text(encoding='utf-8')).get('synthetic_demo'):
        parser.error('不会向已有私人库加入演示；追加需要合成演示标记和 --append-demo')
settings=Settings.load();settings.data_dir=args.data_dir;settings.database_url='';settings.session_secret='';settings.rea_enabled=False;settings.demo_mode=True
photo_url='https://resources.ikea.cn/pvid/1074767_fe001678.jpg'
_,_,photo=asyncio.run(download_public(photo_url))
app=create_app(settings)
with TestClient(app) as client:
    client.post('/api/auth/demo/xiaolin')
    response=client.post('/api/assets',files={'file':('LACK-official-photo.jpg',photo,'image/jpeg')});response.raise_for_status();picture=response.json()['id']
    response=client.post('/api/items',json={'name':'LACK 桌腿定位 · 合成演示','photo_id':picture,
        'product':{'brand':'IKEA','model':'LACK','edition':'104.499.09','source_urls':[
            'https://www.ikea.cn/cn/zh/p/lack-la-ke-bian-zhuo-bai-se-10449909/',photo_url]}})
    response.raise_for_status();item=response.json()
    with app.state.sessions() as db:
        progress={}
        if args.video_file:
            if not args.video_file.is_file() or args.video_file.stat().st_size>50*1024*1024: parser.error('演示片段需要是50MB内的本地视频')
            media_type=mimetypes.guess_type(args.video_file.name)[0] or ''
            if not media_type.startswith('video/'):parser.error('请提供浏览器支持的视频文件')
            identity=uid();destination=settings.data_dir/'assets'/identity;shutil.copyfile(args.video_file,destination)
            db.add(Asset(id=identity,owner_id='person_demo_owner',path=str(destination.resolve()),media_type=media_type,original_name='controlled-synthetic-motion-demo'+args.video_file.suffix));db.commit()
            progress['demo_video_id']=identity
        task=foundation.save_task(db,'person_demo_owner','explicit_camera_demo','找到大桌最前方的桌腿',[item['id']],{'synthetic_demo':True,'photo_source':photo_url},
            {'schema':'interaction/1','kind':'guidance','guidance':progress,'entries':[{'id':'front-leg','title':'核对要检查的桌腿','item_id':item['id'],'group':'step','guidance':{
                'kind':'observe','instruction':'先核对位置。演示片段中可用“画面最下方”的方位提示；框选不会代替实际检查。',
                'target_label':'最靠近画面下边缘的大桌前方白色桌腿，不是小桌腿','success_signal':'框的位置与你要看的部位一致。'}}]})
manifest={'synthetic_demo':True,'data_dir':str(settings.data_dir),'camera_task_id':task['id'],'route':'/#companion?task='+task['id'],
    'instructions':'同目录启动后登录小林，打开 route；选试看片段/相机，再用方位提示按需定位。定位按钮调用真实百炼。'}
marker.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
(args.data_dir/'camera-demo-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(manifest,ensure_ascii=False))
