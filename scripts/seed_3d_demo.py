"""Create a synthetic-owned, real-source LACK teaching case. No paid model call."""
import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from wujian import domain,foundation
from wujian.api_models import ItemCreate,ProductSpec
from wujian.config import Settings,ROOT
from wujian.database import SourceRecord,make_database
from wujian.knowledge import fetch_source

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--data-dir',type=Path,default=ROOT/'tmp/a-3d-review')
args=parser.parse_args()
settings=Settings.load();settings.data_dir=args.data_dir;settings.database_url='';settings.session_secret='';settings.rea_enabled=False
if (args.data_dir/'wujian.sqlite3').exists(): parser.error('请选择一个新的演示目录；不会覆盖已有数据库')
settings.prepare();engine,sessions=make_database(settings)
owner='person_demo_owner'
with sessions() as db:
    domain.seed_demo(db)
    item=domain.create_item(db,owner,ItemCreate(name='LACK 新版脚垫图解 · 合成演示',
        product=ProductSpec(brand='IKEA',model='LACK',edition='104.499.09 / AA-2544914-1',
            source_urls=['https://www.ikea.cn/cn/zh/p/lack-la-ke-bian-zhuo-bai-se-10449909/'])))
receipt=asyncio.run(fetch_source(settings,sessions,owner,'https://resources.ikea.cn/cn/zh/assembly_instructions/lack-la-ke-bian-zhuo-bai-se__AA-2544914-1-2.pdf',item['id']))
with sessions() as db:
    source=db.get(SourceRecord,receipt['source_id'])
    task=foundation.save_task(db,owner,'explicit_lack_demo','给 LACK 的一条桌腿装上脚垫',[item['id']],{'synthetic_demo':True},
        {'schema':'interaction/1','kind':'guidance','entries':[{'id':'foot-cap','title':'核对桌腿底端并装脚垫','item_id':item['id'],'group':'step','guidance':{
            'kind':'operate','instruction':'核对第6页图，把153551脚垫对准桌腿有孔的一端按入；先做一条桌腿，另一端先不装。',
            'success_signal':'脚垫贴合桌腿底端。','target_label':'153551圆脚垫',
            'evidence':[{'source_id':source.id,'quote':source.pages[5]['text'],'page':6,'source_model':'LACK'}]}}]})
manifest={'synthetic_demo':True,'data_dir':str(args.data_dir),'task_id':task['id'],'route':'/#companion?task='+task['id'],
    'next':'使用同一 WUJIAN_DATA_DIR 启动应用，登录小林演示账号，打开 route 后点击生成3D图解（该按钮才调用真实百炼）'}
(args.data_dir/'demo-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(manifest,ensure_ascii=False));engine.dispose()
