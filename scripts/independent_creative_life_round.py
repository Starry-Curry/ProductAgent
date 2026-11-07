"""Opt-in independent natural creative journeys; no runtime or main DB writes.

People, ownership and trial reports are synthetic. Registered things are real
domestic durable model identities. Scrap resources enter through ordinary chat.
Frozen questions and private raw evidence are retained before the first call.
"""
from __future__ import annotations

from contextlib import ExitStack
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import time
import traceback
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

CASES = [
    {"id": "earbud_play", "turns": ["下午一个人在家闲得发慌，FreeBuds 4E和手机都在。给我一个能马上玩十分钟的新玩法，别再给歌单，也别让我另买东西或改耳机。今天先一种，我想直接开始。"]},
    {"id": "mini_exhibition", "turns": [
        "我想给朋友做的银色小挂件拍一张像小展览的照片。家里有那台米家台灯1S和L3256，普通A4纸也有；就用手机拿在手里拍，不买东西。给我一个今晚能开始的摆法就好，别一下列五六套。",
        "试摆了一下，挂件反光得厉害，背景边上也露了接缝。手边其实还有描图纸和两个长尾夹，都没在物间登记过。就接着这一套改一个小步骤，别让我先录一遍材料，也先别说照片已经拍好了。",
    ]},
    {"id": "printer_dinner", "turns": ["那台L3256平时只给家里打作业，墨水够，普通A4纸也有。周末家里人聚餐，我想让它帮忙弄一点大家能一起参与的小惊喜，不靠扫码，也不买东西。给我一种能先做出来的小玩法，今晚我就能试试。"]},
    {"id": "television_new_use", "turns": ["客厅那台小米电视L55M5-AZ白天老闲着。我想让它变成家里人路过会停两分钟的小角落，不是循环放照片或视频。手机可以用，不想电脑一直开着，也不买配件。先给我一个值得试的玩法和第一步，系统版本我还没看。"]},
]


def trace_responses(path, base_url, api_key):
    """Read buffered non-streaming search responses without recording headers."""
    import httpx
    import httpx2
    host = urlsplit(base_url).hostname
    restorers = []
    sequence = 0
    for library in (httpx, httpx2):
        old_sync, old_async = library.Client.send, library.AsyncClient.send
        def begin(request):
            nonlocal sequence
            if request.url.host != host or not request.url.path.endswith('/responses'):
                return None
            sequence += 1
            try:
                body = json.loads(request.content)
            except Exception:
                body = {}
            write({'event': 'request', 'id': sequence, 'request': {k: body[k] for k in ('model','input','tools','stream') if k in body}})
            return sequence, bool(body.get('stream'))
        def write(event):
            line = json.dumps(event, ensure_ascii=False).replace(api_key, '[REDACTED_API_KEY]')
            with path.open('a', encoding='utf-8') as handle:
                handle.write(line+'\n')
        def finish(token, response):
            if token is None:
                return
            identity, streaming = token
            row = {'event': 'response', 'id': identity, 'http_status': response.status_code}
            if not streaming:
                try:
                    row['response_json'] = response.json()
                except Exception as error:
                    row['unreadable'] = type(error).__name__
            write(row)
        def send(client, request, *a, _old=old_sync, _begin=begin, _finish=finish, **kw):
            token = _begin(request)
            response = _old(client, request, *a, **kw)
            _finish(token, response)
            return response
        async def asend(client, request, *a, _old=old_async, _begin=begin, _finish=finish, **kw):
            token = _begin(request)
            response = await _old(client, request, *a, **kw)
            _finish(token, response)
            return response
        library.Client.send, library.AsyncClient.send = send, asend
        restorers.append((library, old_sync, old_async))
    def restore():
        for library, old_sync, old_async in restorers:
            library.Client.send, library.AsyncClient.send = old_sync, old_async
    return restore


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--real', action='store_true')
    args = parser.parse_args()
    if not args.real:
        parser.error('--real required: existing authorized Bailian calls')
    sys.stdout.reconfigure(encoding='utf-8', errors='backslashreplace')
    from fastapi.testclient import TestClient
    from sqlalchemy import select
    from wujian.config import Settings
    from wujian.database import ItemRecord, TaskRecord, SourceRecord, Memory, KnowledgeClaim
    from wujian.server import create_app
    from scripts.real_creative_eval import RequestBudget, execution_manifest
    from scripts.real_family_social_eval import ProviderTrace
    from scripts.import_creative_catalog import import_catalog
    config = Settings.load()
    if not config.api_key:
        raise RuntimeError('Existing Bailian key absent')
    output = ROOT/'tmp/acceptance/2026-11-07_independent_creative_life'/time.strftime('%H%M%S')
    output.mkdir(parents=True, exist_ok=False)
    (output/'frozen-cases.json').write_text(json.dumps(CASES,ensure_ascii=False,indent=2),encoding='utf-8')
    (output/'probe-script.py').write_bytes(Path(__file__).read_bytes())
    config.data_dir, config.database_url, config.session_secret = output/'data', '', ''
    config.demo_mode, config.rea_enabled = False, False
    budget = RequestBudget(output/'budget.sqlite3',limit=None)
    restore_budget = budget.install(config.base_url)
    restore_trace = ProviderTrace(output/'provider-trace.jsonl',config.api_key).install(config.base_url)
    restore_search = trace_responses(output/'search-provider-trace.jsonl',config.base_url,config.api_key)
    report = {'independent_acceptance':True,'synthetic':['people','ownership','utterances','physical trial report'],
        'real':['domestic durable model identities','actual AgentRunner/HTTP and Bailian'],
        'conditions':execution_manifest(config,ROOT),'frozen_cases':CASES,
        'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'turns':[],'errors':[]}
    def checked(response):
        if not response.is_success:
            raise RuntimeError(f'HTTP {response.status_code}: {response.text[:1000]}')
        return response.json()
    def save():
        report['budget']=budget.summary()
        (output/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    def sql(full=False):
        models=[ItemRecord,TaskRecord,Memory,KnowledgeClaim]+([SourceRecord] if full else [])
        with app.state.sessions() as db:
            return {m.__tablename__:[{col.name:getattr(row,col.name) for col in m.__table__.columns} for row in db.scalars(select(m))] for m in models}
    print(json.dumps({'artifact':str(output),'model':config.model},ensure_ascii=False),flush=True)
    save()
    try:
        app=create_app(config)
        with TestClient(app) as client:
            user=checked(client.post('/api/auth/register',json={'username':'creative_independent','display_name':'阿田（合成人物）','password':'synthetic-creative-life-2026'}))
            items=[]
            for data in [
                {'name':'华为FreeBuds 4E','product':{'brand':'HUAWEI 华为','model':'FreeBuds 4E','market':'CN'},'description':'合成拥有：双耳在，能正常播放，当前电量和手机系统未报告。'},
                {'name':'书桌米家台灯1S','product':{'brand':'小米','model':'MJTD01SYL','market':'CN'},'description':'合成拥有：可正常点亮，当前亮度、灯头位置与固件未知。'},
                {'name':'家里的爱普生L3256','product':{'brand':'EPSON 爱普生','model':'L3256','market':'CN'},'description':'合成拥有：打印正常，有普通A4纸和足够墨水，没有照片纸。'},
                {'name':'客厅小米电视','product':{'brand':'小米','model':'L55M5-AZ','market':'CN'},'description':'合成拥有：电视与遥控器可正常使用，当前系统版本与手机系统未知。'},
            ]:
                items.append(checked(client.post('/api/items',json=data)))
            catalog_path=ROOT/'fixtures/inspiration/catalog.json'
            catalog=json.loads(catalog_path.read_text(encoding='utf-8'))
            with sqlite3.connect(f"file:{(ROOT/'var/wujian.sqlite3').as_posix()}?mode=ro",uri=True) as source, app.state.sessions() as db:
                source.row_factory=sqlite3.Row
                for ref in catalog['references'].values():
                    row=source.execute("SELECT id,origin,title,url,content,pages,fetched_at FROM sources WHERE id=? AND origin='public_web' AND item_id IS NULL",(ref['original_source_id'],)).fetchone()
                    if not row:
                        raise RuntimeError('Public reference missing')
                    data=dict(row);data['pages']=json.loads(data['pages'])
                    db.add(SourceRecord(**data,owner_id=user['id']))
                db.commit()
                imported=import_catalog(db,user['id'],catalog_path,apply=True)
            report['fixture']={'user':user,'items':items,'public_catalog_import':imported}
            save()
            for case in CASES:
                conversation=None
                for index,text in enumerate(case['turns'],1):
                    row={'case':case['id'],'index':index,'request':{'text':text,'conversation_id':conversation,'item_ids':[],'photo_ids':[],'entry_context':{'intent':'general'}},'sql_before':sql()}
                    report['turns'].append(row);save()
                    started=time.monotonic()
                    run=checked(client.post('/api/chat',json=row['request']))
                    while run['status'] in {'queued','running'} and time.monotonic()-started<300:
                        time.sleep(.6);run=checked(client.get(f"/api/runs/{run['id']}"))
                    if run['status'] in {'queued','running'}:
                        row['before_cancel']=run
                        checked(client.post(f"/api/runs/{run['id']}/cancel"));run=checked(client.get(f"/api/runs/{run['id']}"))
                    row.update(run=run,elapsed_seconds=round(time.monotonic()-started,3),sql_after=sql(),workspace=checked(client.get('/api/workspace')))
                    conversation=run['conversation_id'];save()
                    print(json.dumps({'case':case['id'],'turn':index,'status':run['status'],'answer':run['text'],'error':run.get('error'),'seconds':row['elapsed_seconds'],'tools':[e['name'] for e in run.get('events',[]) if e.get('type')=='tool_start']},ensure_ascii=False),flush=True)
            report['final_sql']=sql(full=True);save()
    except BaseException:
        report['errors'].append(traceback.format_exc());save();raise
    finally:
        restore_search();restore_trace();restore_budget();save()
        print(json.dumps({'artifact':str(output),'budget':budget.summary(),'errors':report['errors']},ensure_ascii=False),flush=True)


if __name__=='__main__':
    main()
