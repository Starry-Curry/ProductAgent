"""One authorized real-model development probe of the item 'ask usage' entry.

New synthetic account, one real CN model identity, no sources/history/answers.
This uses the actual UI HTTP contract; it does not override the Agent prompt.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
import time
import traceback

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
QUESTION="这台爱普生L3256打印出来总有横向白条，我现在只有手机在手边。不想一上来就耗墨清洗，先带我做第一步就行。"


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--real',action='store_true')
    parser.add_argument('--reader-retest',action='store_true',help='One authorized development retest after the unique-declared-manual reader and shared Skill integration')
    args=parser.parse_args()
    if not args.real:
        parser.error('--real required: existing authorized Bailian account')
    if args.reader_retest:
        original=json.loads((ROOT/'tmp/acceptance/2026-11-07_item_guidance_entry/053526/results.json').read_text(encoding='utf-8'))['frozen_question']
        if QUESTION.encode('utf-8')!=original.encode('utf-8'):
            raise RuntimeError('Original question bytes changed')
    sys.stdout.reconfigure(encoding='utf-8',errors='backslashreplace')
    from fastapi.testclient import TestClient
    from sqlalchemy import select
    from wujian.config import Settings
    from wujian.database import ItemRecord,TaskRecord,SourceRecord,Memory,KnowledgeClaim
    from wujian.server import create_app
    from scripts.real_creative_eval import RequestBudget,execution_manifest
    from scripts.real_family_social_eval import ProviderTrace
    from scripts.independent_creative_life_round import trace_responses
    config=Settings.load()
    if not config.api_key:
        raise RuntimeError('Existing Bailian configuration missing')
    output=ROOT/'tmp/acceptance/2026-11-07_item_guidance_entry'/time.strftime('%H%M%S')
    output.mkdir(parents=True,exist_ok=False)
    (output/'probe-script.py').write_bytes(Path(__file__).read_bytes())
    config.data_dir=output/'data';config.database_url='';config.session_secret='';config.demo_mode=False;config.rea_enabled=False
    budget=RequestBudget(output/'budget.sqlite3',limit=None)
    restore_budget=budget.install(config.base_url)
    restore_trace=ProviderTrace(output/'provider-trace.jsonl',config.api_key).install(config.base_url)
    restore_search=trace_responses(output/'search-provider-trace.jsonl',config.base_url,config.api_key)
    report={'kind':'item_usage_entry_development_validation','independent_acceptance':False,
        'synthetic':['account','ownership','utterance'],'real':['CN Epson L3256 model identity','actual HTTP/AgentRunner/Bailian'],
        'entry_contract':'Items.tsx ask(item,guidance) -> App.tsx newTopic([item.id],guidance) -> /api/chat',
        'frozen_question':QUESTION,'conditions':execution_manifest(config,ROOT),
        'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'errors':[]}
    if args.reader_retest:
        report.update(kind='item_usage_entry_after_unique_manual_reader_development_retest',
            original_report='tmp/acceptance/2026-11-07_item_guidance_entry/053526/results.json',
            question_utf8_sha256=hashlib.sha256(QUESTION.encode('utf-8')).hexdigest(),
            condition='Same original question, fresh account/item/empty sources/new conversation; shared Skill and new reader, not an independent first answer or isolated single-variable comparison')
    def checked(response):
        if not response.is_success:
            raise RuntimeError(f'HTTP {response.status_code}: {response.text[:1200]}')
        return response.json()
    def save():
        report['budget']=budget.summary()
        (output/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    def sql():
        with app.state.sessions() as db:
            return {m.__tablename__:[{col.name:getattr(row,col.name) for col in m.__table__.columns} for row in db.scalars(select(m))] for m in [ItemRecord,TaskRecord,SourceRecord,Memory,KnowledgeClaim]}
    print(json.dumps({'artifact':str(output),'kind':report['kind']},ensure_ascii=False),flush=True);save()
    try:
        app=create_app(config)
        with TestClient(app) as client:
            user=checked(client.post('/api/auth/register',json={'username':'usage_entry_probe','display_name':'小陈（合成人物）','password':'synthetic-usage-entry-2026'}))
            item=checked(client.post('/api/items',json={'name':'书房的爱普生L3256','product':{'brand':'EPSON 爱普生','model':'L3256','market':'CN'},
                'description':'合成拥有：有普通A4纸，当前可以进纸打印；当前墨量、手机系统及最近清洗情况未知。'}))
            report['fixture']={'user':user,'item':item}
            report['sql_before']=sql()
            if report['sql_before']['sources'] or report['sql_before']['tasks'] or report['sql_before']['knowledge_claims']:
                raise RuntimeError('Fresh empty-source setup condition failed')
            report['request']={'text':QUESTION,'conversation_id':None,'item_ids':[item['id']],'photo_ids':[],'entry_context':{'intent':'guidance'}}
            save()
            started=time.monotonic();run=checked(client.post('/api/chat',json=report['request']))
            while run['status'] in {'queued','running'} and time.monotonic()-started<245:
                time.sleep(.6);run=checked(client.get(f"/api/runs/{run['id']}"))
            if run['status'] in {'queued','running'}:
                report['before_cancel']=run;checked(client.post(f"/api/runs/{run['id']}/cancel"));run=checked(client.get(f"/api/runs/{run['id']}"))
            report.update(run=run,elapsed_seconds=round(time.monotonic()-started,3),sql_after=sql(),workspace=checked(client.get('/api/workspace')));save()
            print(json.dumps({'status':run['status'],'answer':run['text'],'error':run.get('error'),'seconds':report['elapsed_seconds'],
                'tools':[e['name'] for e in run['events'] if e.get('type')=='tool_start']},ensure_ascii=False),flush=True)
    except BaseException:
        report['errors'].append(traceback.format_exc());save();raise
    finally:
        restore_search();restore_trace();restore_budget();save()
        print(json.dumps({'artifact':str(output),'budget':budget.summary(),'errors':report['errors']},ensure_ascii=False),flush=True)


if __name__=='__main__':
    main()
