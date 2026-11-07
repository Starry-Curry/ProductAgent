"""Replay the frozen printer/TV prompt after source-discovery fixes.

Clones only synthetic SQL/assets/session state. A TV clone rewinds precisely its
last synthetic case; originals remain untouched. Retrieval is rebuilt from SQL.
No correct manual, endpoint or device answer is added to the Agent context.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import sys
import time
import traceback
from urllib.parse import urlsplit

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
RECOVERY_PROMPT="先别再拿别的型号试。你刚才不是找到了写着L3256的用户指南吗？就顺着那份继续下载读清楚再教我。我还没按任何键，先给我一个现在能做的小步骤。"


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--real',action='store_true')
    parser.add_argument('--case',choices=['printer','television','printer_recovery'],required=True)
    parser.add_argument('--require-source-pointer',action='store_true',help='Recovery only: refuse all paid transmission until actual first chat request contains the accurate already-retained source pointer')
    parser.add_argument('--control-variable',choices=['source_pointer','read_source_navigation'],default='source_pointer',help='Record the single authorized runtime repair under evaluation; does not change model input')
    args=parser.parse_args()
    if not args.real:
        parser.error('--real required: calls existing authorized Bailian')
    if args.require_source_pointer and args.case!='printer_recovery':
        parser.error('--require-source-pointer is only valid for printer_recovery')
    sys.stdout.reconfigure(encoding='utf-8',errors='backslashreplace')
    from fastapi.testclient import TestClient
    from sqlalchemy import select
    from wujian.config import Settings
    from wujian.database import ItemRecord, TaskRecord, SourceRecord, Memory, KnowledgeClaim
    from wujian.server import create_app
    from scripts.real_creative_eval import RequestBudget,execution_manifest
    from scripts.real_family_social_eval import ProviderTrace
    from scripts.independent_creative_life_round import trace_responses,CASES
    from scripts.independent_life_acceptance import FROZEN
    parent=ROOT/{'printer':'tmp/acceptance/2026-11-07_independent_life/041933',
        'television':'tmp/acceptance/2026-11-07_independent_creative_life/043850',
        'printer_recovery':'tmp/acceptance/2026-11-07_discovery_regression/printer-045256'}[args.case]
    prior=json.loads((parent/'results.json').read_text(encoding='utf-8'))
    output=ROOT/'tmp/acceptance/2026-11-07_discovery_regression'/f"{args.case}-{time.strftime('%H%M%S')}"
    output.mkdir(parents=True,exist_ok=False)
    data=output/'data';data.mkdir()
    shutil.copy2(parent/'data/wujian.sqlite3',data/'wujian.sqlite3')
    shutil.copy2(parent/'data/session.key',data/'session.key')
    shutil.copytree(parent/'data/assets',data/'assets')
    cleanup={'retrieval_projection':'not copied; rebuild from canonical synthetic SQL'}
    with sqlite3.connect(data/'wujian.sqlite3') as db:
        db.execute('PRAGMA foreign_keys=ON')
        for identity,path in db.execute('SELECT id,path FROM assets').fetchall():
            db.execute('UPDATE assets SET path=? WHERE id=?',(str((data/'assets'/Path(path).name).resolve()),identity))
        if args.case=='television':
            last=next(t for t in prior['turns'] if t['case']=='television_new_use')
            conv=last['run']['conversation_id']
            task_ids={t['id'] for t in last['sql_after']['tasks']}-{t['id'] for t in last['sql_before']['tasks']}
            source_ids={row['source_id'] for e in last['run']['events'] for row in e.get('evidence',{}).get('original_reads',[]) if row.get('source_id')}
            db.execute('DELETE FROM messages WHERE conversation_id=?',(conv,))
            db.execute('DELETE FROM runs WHERE conversation_id=?',(conv,))
            db.execute('DELETE FROM conversations WHERE id=?',(conv,))
            for identity in task_ids:
                db.execute('DELETE FROM task_participants WHERE task_id=?',(identity,))
                db.execute('DELETE FROM tasks WHERE id=?',(identity,))
            for identity in source_ids:
                db.execute('DELETE FROM sources WHERE id=?',(identity,))
            cleanup.update(removed_synthetic_conversation=conv,removed_synthetic_task_ids=sorted(task_ids),removed_case_source_ids=sorted(source_ids))
            text=next(c['turns'][0] for c in CASES if c['id']=='television_new_use')
            conversation=None;username='creative_independent';password='synthetic-creative-life-2026'
        elif args.case=='printer_recovery':
            text=RECOVERY_PROMPT
            if args.require_source_pointer:
                original_correction=json.loads((ROOT/'tmp/acceptance/2026-11-07_discovery_regression/printer_recovery-050457/results.json').read_text(encoding='utf-8'))['request']['text']
                if text.encode('utf-8')!=original_correction.encode('utf-8'):
                    raise RuntimeError('Frozen correction bytes changed')
                text=original_correction
            conversation=prior['run']['conversation_id']
            username='life_owner';password='synthetic-life-2026'
        else:
            text=FROZEN['guidance_mobile'][0]
            conversation=next(t['run']['conversation_id'] for t in prior['turns'] if t['journey']=='learning_control' and t['index']==2)
            username='life_owner';password='synthetic-life-2026'
    (output/'probe-script.py').write_bytes(Path(__file__).read_bytes())
    config=Settings.load();config.data_dir=data;config.database_url='';config.session_secret='';config.demo_mode=False;config.rea_enabled=False
    if not config.api_key:
        raise RuntimeError('Existing Bailian key absent')
    budget=RequestBudget(output/'budget.sqlite3',limit=None)
    restore_budget=budget.install(config.base_url)
    restore_trace=ProviderTrace(output/'provider-trace.jsonl',config.api_key).install(config.base_url)
    restore_search=trace_responses(output/'search-provider-trace.jsonl',config.base_url,config.api_key)
    report={'independent_acceptance':False,'kind':'frozen_question_source_discovery_regression','case':args.case,'parent_report':str(parent/'results.json'),
        'synthetic_clone_cleanup':cleanup,'conditions':execution_manifest(config,ROOT),'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'request':{'text':text,'conversation_id':conversation,'item_ids':[],'photo_ids':[],'entry_context':{'intent':'general'}},'errors':[]}
    if args.case=='printer_recovery':
        report.update(kind='user_corrected_bounded_recovery_not_independent',
            condition='One natural user correction after the preserved failed run; no manual URL, download ID, button or page injected; stop after this one run')
    if args.require_source_pointer:
        report.update(kind='source_pointer_controlled_user_corrected_recovery_not_independent',
            correction_utf8_sha256=hashlib.sha256(text.encode('utf-8')).hexdigest(),
            controlled_difference='Current source-pointer/list ordering fix; original printer-045256 baseline and identical correction; no data from later wrong-HTML recovery copied',
            first_request_preflight={'checked':False,'passed':False,'required_source_id':'8df015960c3643188fd007e0475c631c'})
        if args.control_variable=='read_source_navigation':
            report.update(kind='read_source_navigation_controlled_user_corrected_recovery_not_independent',
                controlled_difference='Current read_source retained-navigation reopen fix; prior source-pointer/list ordering, metadata and Skill frozen; original printer-045256 baseline and byte-identical correction')
    def save():
        report['budget']=budget.summary();(output/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    def checked(response):
        if not response.is_success:
            raise RuntimeError(f'HTTP {response.status_code}: {response.text[:1000]}')
        return response.json()
    def sql():
        with app.state.sessions() as db:
            return {m.__tablename__:[{c.name:getattr(row,c.name) for c in m.__table__.columns} for row in db.scalars(select(m))] for m in [ItemRecord,TaskRecord,Memory,KnowledgeClaim,SourceRecord]}
    restore_gate=lambda:None
    if args.require_source_pointer:
        import httpx
        import httpx2
        host=urlsplit(config.base_url).hostname
        gate=report['first_request_preflight']
        originals=[]
        def check_request(request):
            paid=request.url.host==host or request.url.host.endswith('.dashscope.aliyuncs.com') or request.url.host=='dashscope.aliyuncs.com'
            if not paid or gate['passed']:
                return
            if gate['checked']:
                raise asyncio.CancelledError('Controlled preflight failed; no provider transmission permitted')
            if not request.url.path.endswith('/chat/completions'):
                gate.update(checked=True,passed=False,error='Unexpected paid endpoint before the first chat request',endpoint=request.url.path)
                save()
                raise asyncio.CancelledError('No paid request allowed before first-chat source-pointer preflight')
            body=json.loads(request.content)
            pointers=[]
            for message in body.get('messages',[]):
                if message.get('role')!='system':
                    continue
                content=message.get('content')
                texts=[content] if isinstance(content,str) else [part.get('text','') for part in (content or []) if isinstance(part,dict)]
                for value in texts:
                    marker='"previously_read_sources"'
                    where=value.find(marker)
                    if where<0:
                        continue
                    start=value.find(':',where+len(marker))+1
                    try:
                        actual,_=json.JSONDecoder().raw_decode(value[start:].lstrip())
                    except ValueError:
                        continue
                    if isinstance(actual,list):
                        pointers.extend(actual)
            passed=any(p.get('source_id')==gate['required_source_id'] for p in pointers if isinstance(p,dict))
            gate.update(checked=True,passed=passed,previously_read_sources=pointers,upstream_attempts_before_first_chat=budget.local_attempts)
            raw=json.dumps({'prepared_request':{key:body[key] for key in ('model','messages','tools','stream') if key in body},'preflight':gate},ensure_ascii=False,indent=2).replace(config.api_key,'[REDACTED_API_KEY]')
            (output/'first-request-preflight.json').write_text(raw,encoding='utf-8')
            save()
            print(json.dumps({'first_request_preflight':gate},ensure_ascii=False),flush=True)
            if not passed:
                raise asyncio.CancelledError('Accurate retained source absent from actual previously_read_sources; zero-call stop')
        for library in (httpx,httpx2):
            sync,asynchronous=library.Client.send,library.AsyncClient.send
            def send(client,request,*a,_old=sync,**kw):
                check_request(request)
                return _old(client,request,*a,**kw)
            async def asend(client,request,*a,_old=asynchronous,**kw):
                check_request(request)
                return await _old(client,request,*a,**kw)
            library.Client.send,library.AsyncClient.send=send,asend
            originals.append((library,sync,asynchronous))
        def restore_gate():
            for library,sync,asynchronous in originals:
                library.Client.send,library.AsyncClient.send=sync,asynchronous
    print(json.dumps({'artifact':str(output),'case':args.case},ensure_ascii=False),flush=True);save()
    try:
        app=create_app(config)
        with TestClient(app) as client:
            checked(client.post('/api/auth/login',json={'username':username,'password':password}))
            report['sql_before']=sql();save()
            started=time.monotonic();run=checked(client.post('/api/chat',json=report['request']))
            while run['status'] in {'queued','running'} and time.monotonic()-started<(245 if args.case=='printer_recovery' else 300):
                time.sleep(.6);run=checked(client.get(f"/api/runs/{run['id']}"))
            if run['status'] in {'queued','running'}:
                report['before_cancel']=run;checked(client.post(f"/api/runs/{run['id']}/cancel"));run=checked(client.get(f"/api/runs/{run['id']}"))
            report.update(run=run,elapsed_seconds=round(time.monotonic()-started,3),sql_after=sql(),workspace=checked(client.get('/api/workspace')));save()
            print(json.dumps({'case':args.case,'status':run['status'],'answer':run['text'],'error':run.get('error'),'seconds':report['elapsed_seconds'],'tools':[e['name'] for e in run.get('events',[]) if e.get('type')=='tool_start']},ensure_ascii=False),flush=True)
    except BaseException:
        report['errors'].append(traceback.format_exc());save();raise
    finally:
        restore_gate()
        restore_search();restore_trace();restore_budget();save()
        print(json.dumps({'artifact':str(output),'budget':budget.summary(),'errors':report['errors']},ensure_ascii=False),flush=True)


if __name__=='__main__':
    main()
