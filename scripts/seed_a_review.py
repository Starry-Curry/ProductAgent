"""Seed both A demos using their existing shared operations. No paid model calls."""
import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--data-dir',type=Path,default=ROOT/'tmp/a-review-fresh')
parser.add_argument('--video-file',type=Path,help='Optional local synthetic-motion video for the camera demo')
args=parser.parse_args()
data=args.data_dir.resolve()
if (data/'wujian.sqlite3').exists():parser.error('请选择新的演示目录；不会覆盖已有数据库')
if args.video_file and (not args.video_file.is_file() or args.video_file.stat().st_size>50*1024*1024):
    parser.error('演示视频需要是50MB以内的现有文件')
subprocess.run([sys.executable,'-X','utf8',str(ROOT/'scripts/seed_3d_demo.py'),'--data-dir',str(data)],cwd=ROOT,check=True)
diagram=json.loads((data/'demo-manifest.json').read_text(encoding='utf-8'))
command=[sys.executable,'-X','utf8',str(ROOT/'scripts/seed_camera_demo.py'),'--data-dir',str(data),'--append-demo']
if args.video_file:command+=['--video-file',str(args.video_file.resolve())]
subprocess.run(command,cwd=ROOT,check=True)
camera=json.loads((data/'camera-demo-manifest.json').read_text(encoding='utf-8'))
manifest={'synthetic_demo':True,'data_dir':str(data),'diagram_task_id':diagram['task_id'],
    'camera_task_id':camera['camera_task_id'],'diagram_route':diagram['route'],'camera_route':camera['route'],
    'note':'使用此 WUJIAN_DATA_DIR 启动，登录小林；点击生成/定位时才调用真实百炼。拥有关系虚构，来源真实。'}
(data/'demo-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(manifest,ensure_ascii=False,indent=2))
