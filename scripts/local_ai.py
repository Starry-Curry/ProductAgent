"""Download/probe the optional semantic model; no cloud inference or device fallback."""
import argparse,hashlib,json,sys,time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
MODEL='sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2'
REVISION='e8f8c211226b894fcb81acc59f3b34ba3efd5f42'


def download(folder):
    import httpx
    folder.mkdir(exist_ok=True,parents=True);files={}
    with httpx.Client(timeout=120,follow_redirects=True) as client:
        for remote in ['openvino/openvino_model.xml','openvino/openvino_model.bin','tokenizer.json']:
            path=folder/Path(remote).name
            if not path.exists():
                temp=path.with_suffix(path.suffix+'.partial')
                with client.stream('GET',f'https://huggingface.co/{MODEL}/resolve/{REVISION}/{remote}') as response:
                    response.raise_for_status()
                    with temp.open('wb') as output:
                        for block in response.iter_bytes(1024*1024):output.write(block)
                temp.replace(path)
            files[path.name]=hashlib.sha256(path.read_bytes()).hexdigest()
            print(json.dumps({'file':path.name,'bytes':path.stat().st_size}),flush=True)
    (folder/'manifest.json').write_text(json.dumps({'model_id':MODEL,'revision':REVISION,'license':'Apache-2.0','files':files},indent=2),encoding='utf-8')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=['download','probe'])
    parser.add_argument('--folder',type=Path,default=ROOT/'var/models/multilingual-minilm');parser.add_argument('--device',choices=['CPU','GPU','NPU'],default='NPU')
    parser.add_argument('--seconds',type=float,default=0,help='Repeat real inference so Task Manager can be inspected')
    parser.add_argument('--output',type=Path);parser.add_argument('--require-accelerator',action='store_true');args=parser.parse_args()
    if args.action=='download':download(args.folder)
    else:
        import openvino as ov
        from wujian.local_embedding import LocalEmbedding
        local=LocalEmbedding(args.folder,args.device,args.require_accelerator)
        documents={'power':'LOKLiK AS2 左端带电源符号的按键用于开关机。','drawer':'下方熨烫板向前抽出后摆放布料。','mode':'模式键用于选择温度、时间和压力。'}
        first,scores,receipt=local.rank('这台机器应该按哪个按钮开机？',documents)
        end=time.monotonic()+args.seconds
        while time.monotonic()<end:local.rank('需要把布料放在哪一处？',documents)
        value={'available_devices':ov.Core().available_devices,'software_version':ov.__version__,'first_rank':first,'scores':scores,'first_receipt':receipt,'last_receipt':local.last,
            'semantic_check':first[0]=='power','accelerator_inference_verified':receipt['accelerator_executed'],
            'target_intel_machine_acceptance':'pending_on_organizer_device'}
        if args.output:args.output.parent.mkdir(exist_ok=True,parents=True);args.output.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(value,ensure_ascii=False,indent=2))
