"""Real application/model/source journeys; never run in CI without --real.

Photographs are user supplied. Accounts, ownership and reports are synthetic.
The script records first answers and failures; it does not simulate successful
physical operation or award itself an independent benchmark pass.
"""
import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from fastapi.testclient import TestClient
from wujian.config import Settings
from wujian.server import create_app


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--real',action='store_true')
    parser.add_argument('--output',type=Path)
    parser.add_argument('--only',choices=['all','speaker','mouse','lamp'],default='all')
    parser.add_argument('--text-only',action='store_true',help='Never read or send local photographs; use user-provided model text for the speaker.')
    args=parser.parse_args()
    if not args.real:parser.error('--real is required; uses the configured Bailian account')
    settings=Settings.load()
    if not settings.api_key:raise RuntimeError('Configure the existing local Bailian account first')
    folder=args.output or ROOT/'var/evaluations'/('adaptive-'+datetime.now().strftime('%Y%m%d-%H%M%S'))
    folder.mkdir(parents=True,exist_ok=False)
    settings.data_dir=folder/'data';settings.database_url='';settings.session_secret='';settings.rea_enabled=False
    report={'kind':'development_real_application_journeys','independent_acceptance':False,
        'physical_operation_verified':False,'model':settings.model,'started_at':datetime.now().isoformat(),
        'preloaded_product_answers':False,'cases':[]}
    def save():
        (folder/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    def checked(response):response.raise_for_status();return response.json()
    app=create_app(settings)
    with TestClient(app) as client:
        checked(client.post('/api/auth/demo/xiaolin'))
        # Deliberately unrelated recent task. Its content must not become another
        # object's answer. This is a labelled synthetic contamination sentinel.
        other=checked(client.post('/api/items',json={'name':'示例AS2烫印机','product':{'brand':'LOKLiK','model':'AS2'},
            'state':{'data_origin':'development_simulation'}}))
        checked(client.post('/api/task-boards',json={'goal':'学习烫印机的使用','kind':'guidance','item_ids':[other['id']],
            'entries':[{'id':'panel','title':'核对烫印机面板','item_id':other['id'],'group':'step',
                'guidance':{'kind':'observe','basis':'general','instruction':'先看烫印机外观。','target_label':'面板'}}]}))
        jobs=[]
        definitions=[
            ('speaker','我的智能音箱',{'brand':'天猫精灵'},'请先从照片核对具体型号和版本，再查找适用资料，带我分步骤用它连接手机蓝牙。'),
            ('mouse','我的无线鼠标',{'brand':'罗技','model':'M330','market':'CN'},'我第一次用这只鼠标，请查找适用的使用资料，分步骤带我连接电脑。'),
            ('lamp','我的台灯',{'brand':'米家','model':'MJTD01SYL','market':'CN'},'请先核对这款台灯的使用资料，然后一步步带我调节亮度。')]
        for key,name,product,question in definitions:
            if args.only not in {'all',key}:continue
            photos=[]
            if key=='speaker' and args.text_only:
                product={**product,'model':'TG_C1'}
                question='这台天猫精灵的铭牌型号是TG_C1，前面是橙色点阵网罩。目前不上传照片。请核对适用资料，再分步骤带我连接手机蓝牙。'
            if key=='speaker' and not args.text_only:
                for filename in ['1.jpg','2.jpg']:
                    path=ROOT/'data/realdemo/tianmao'/filename
                    with path.open('rb') as file:photos.append(checked(client.post('/api/assets',files={'file':(filename,file,'image/jpeg')}))['id'])
            item=checked(client.post('/api/items',json={'name':name,'product':product,'photo_id':photos[0] if photos else None,
                'state':{'data_origin':'development_simulation'}}))
            run=checked(client.post('/api/chat',json={'text':question,'item_ids':[item['id']], 'photo_ids':photos[1:]}))
            entry={'name':key,'item_id':item['id'],'question':question,'photo_input':bool(photos),'run_id':run['id'],'first_run':None}
            report['cases'].append(entry);jobs.append((entry,run));save()
        deadline=time.monotonic()+190
        for entry,run in jobs:
            last=None
            while run['status'] in {'queued','running'} and time.monotonic()<deadline:
                time.sleep(.5);run=checked(client.get('/api/runs/'+run['id']))
                state=(run['status'],len(run['events']))
                if state!=last:
                    print(entry['name'],run['status'],[(e['type'],e.get('name')) for e in run['events'][-3:]],flush=True);last=state
            entry['first_run']=run
            if run['status'] in {'queued','running'}:
                checked(client.post('/api/runs/'+run['id']+'/cancel'));entry['deadline_exceeded']=True
            entry['item_after']=checked(client.get('/api/items/'+entry['item_id']))
            entry['tasks']=[task for task in checked(client.get('/api/tasks')) if entry['item_id'] in task['item_ids']]
            for task in entry['tasks']:
                current=(task['plan'].get('guidance') or {}).get('active_step_id')
                if current and entry['name']=='speaker':
                    entry['picture_response']=client.post('/api/tasks/'+task['id']+'/picture',json={
                        'expected_version':task['version'],'step_id':current}).json()
            save()
        # One natural negative-feedback turn: no fabricated physical success.
        for entry,_ in jobs:
            run=entry.get('first_run') or {}
            if entry['name']!='speaker' or run.get('status')!='completed':continue
            follow=checked(client.post('/api/chat',json={'text':'我还没找到你说的位置，先别跳到下一步。',
                'conversation_id':run['conversation_id']}))
            end=time.monotonic()+165
            while follow['status'] in {'queued','running'} and time.monotonic()<end:
                time.sleep(.5);follow=checked(client.get('/api/runs/'+follow['id']))
            if follow['status'] in {'queued','running'}:checked(client.post('/api/runs/'+follow['id']+'/cancel'))
            entry['negative_feedback_run']=follow
            entry['tasks_after_feedback']=[task for task in checked(client.get('/api/tasks')) if entry['item_id'] in task['item_ids']]
            save()
    report['finished_at']=datetime.now().isoformat();save();print('RESULT',folder/'results.json',flush=True)


if __name__=='__main__':main()
