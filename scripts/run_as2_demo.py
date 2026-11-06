"""Verify bundled assets, prepare a private profile/first step, and serve the real app."""
import argparse
import asyncio
import json
import socket
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from scripts.demo_assets import verify_bundle
from scripts.seed_as2_demo import seed
from wujian.config import Settings
from wujian.database import ChatMessage,Conversation,Run,TaskRecord,make_database


def prepare_demo(settings,bundle,new_session=False):
    bundle=Path(bundle).resolve();assets=verify_bundle(bundle)
    manifest=seed(settings,bundle/assets['media_dir'],bundle/assets['manual'],clean=True,prepared_bundle=bundle)
    marker=settings.data_dir/'as2-launch.json';engine,sessions=make_database(settings)
    try:
        if marker.exists() and not new_session:
            saved=json.loads(marker.read_text(encoding='utf-8'))
            with sessions() as db:
                task=db.get(TaskRecord,saved['task_id'])
                if task and task.user_id=='person_demo_owner':return saved
            raise ValueError('Saved demo task is unavailable; use --new-session to append a fresh lesson')
        with sessions() as db:
            conversation=Conversation(user_id='person_demo_owner',title='学会用 AS2 完成一次烫印',item_ids=[manifest['item_id']],entry_context={'intent':'guidance'})
            db.add(conversation);db.flush()
            run=Run(user_id=conversation.user_id,conversation_id=conversation.id)
            db.add(run);db.flush()
            db.add(ChatMessage(conversation_id=conversation.id,run_id=run.id,role='user',text=manifest['start_text']))
            db.commit();run_id=run.id
        async def start():
            from wujian.agent_runtime import AgentRunner
            runner=AgentRunner(settings,sessions)
            try:await runner.execute(run_id)
            finally:await runner.close()
        asyncio.run(start())
        with sessions() as db:
            run=db.get(Run,run_id)
            if run.status!='completed':raise RuntimeError(run.error or 'Initial lesson did not complete')
            task_id=next(e['task_id'] for e in run.events if e['type']=='continuation_saved')
            value={'task_id':task_id,'conversation_id':run.conversation_id,'item_id':manifest['item_id'],'route':'/#companion?task='+task_id,
                'data_dir':str(settings.data_dir),'bundle_id':assets['id'],'physical_operation_verified':False}
        marker.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');return value
    finally:engine.dispose()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,default=8021);parser.add_argument('--data-dir',type=Path,default=ROOT/'var/as2-demo')
    parser.add_argument('--bundle',type=Path,default=ROOT/'demo/as2');parser.add_argument('--new-session',action='store_true')
    parser.add_argument('--prepare-only',action='store_true');parser.add_argument('--offline',action='store_true',help='View prepared assets only; cloud questions/confirmation remain unavailable')
    args=parser.parse_args();settings=Settings.load()
    if args.offline:
        settings.api_key='';settings.local_embedding_dir='';settings.local_ai_required=False
    elif not settings.api_key:parser.error('Set DASHSCOPE_API_KEY in the repository .env, or use --offline for asset preview only')
    settings.data_dir=args.data_dir.resolve();settings.database_url='';settings.session_secret='';settings.demo_mode=True;settings.rea_enabled=False
    if not args.prepare_only:
        if not (ROOT/'frontend/dist/index.html').is_file():parser.error('Build frontend first: npm --prefix frontend ci; npm --prefix frontend run build')
        with socket.socket() as probe:
            if probe.connect_ex(('127.0.0.1',args.port))==0:parser.error(f'Port {args.port} is occupied; choose --port with a free port')
    result=prepare_demo(settings,args.bundle,args.new_session)
    print(json.dumps({**result,'url':f'http://localhost:{args.port}'+result['route'],'offline_asset_preview_only':args.offline},ensure_ascii=False),flush=True)
    print('Login: choose 小林的物间. Restart resumes the same lesson; --new-session appends a first-step lesson without deleting history.',flush=True)
    if not args.prepare_only:
        import uvicorn
        from wujian.server import create_app
        uvicorn.run(create_app(settings),host='127.0.0.1',port=args.port)


if __name__=='__main__':main()
