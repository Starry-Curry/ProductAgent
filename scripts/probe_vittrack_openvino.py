"""Probe the EXISTING ViTTrack on a requested OpenVINO device, using real video.

Pre/postprocessing follows frontend/src/features/camera/vitTracker.ts (OpenCV,
Apache-2.0). This is a deployment probe, not a claim that browser tracking uses
the NPU. Missing devices fail explicitly; no CPU fallback or saved trajectory.
"""
import argparse,hashlib,json,math,subprocess,tempfile,time
from pathlib import Path


def main():
    import numpy as np
    import openvino as ov
    from PIL import Image
    root=Path(__file__).resolve().parents[1]
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--device',choices=['CPU','GPU','NPU'],default='NPU')
    parser.add_argument('--video',type=Path,required=True)
    parser.add_argument('--box',nargs=4,type=float,required=True,help='First-frame reviewed box on a 405x720 frame')
    parser.add_argument('--frames',type=int,default=90)
    parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    source=root/'frontend/src/vendor/vittrack/vittrack.onnx';core=ov.Core();model=core.read_model(source)
    report={'model':'OpenCV Zoo ViTTrack 2023sep','model_bytes':source.stat().st_size,
        'model_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'requested_device':args.device,'available_devices':core.available_devices,
        'inputs':{port.get_any_name():str(port.get_partial_shape()) for port in model.inputs},
        'browser_integration_changed':False,'cpu_fallback':False,'samples':[]}
    if not any(d==args.device or d.startswith(args.device+'.') for d in core.available_devices):
        report.update(state='device_unavailable',inferences=0,target_npu_verified=False)
    else:
        started=time.monotonic();compiled=core.compile_model(model,args.device,{'PERFORMANCE_HINT':'LATENCY'})
        devices=list(compiled.get_property('EXECUTION_DEVICES'))
        if any(not d.startswith(args.device) for d in devices):raise RuntimeError('Device mismatch')
        report.update(execution_devices=devices,compile_seconds=time.monotonic()-started,
            device_names={d:core.get_property(d,'FULL_DEVICE_NAME') for d in devices},
            target_npu_verified=any(d.startswith('NPU') for d in devices))
        mean=np.asarray([.485,.456,.406],dtype=np.float32);std=np.asarray([.229,.224,.225],dtype=np.float32)
        def crop(image,box,factor,side):
            size=math.ceil(math.sqrt((box[2]-box[0])*(box[3]-box[1]))*factor)
            x=(box[0]+box[2]-size)/2;y=(box[1]+box[3]-size)/2
            picture=image.crop((round(x),round(y),round(x)+size,round(y)+size)).resize((side,side),Image.Resampling.BILINEAR)
            tensor=((np.asarray(picture,dtype=np.float32)/255-mean)/std).transpose(2,0,1)[None]
            return np.ascontiguousarray(tensor),size,x,y
        with tempfile.TemporaryDirectory() as temporary:
            subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-i',str(args.video),'-vf','fps=15,scale=405:720',
                '-frames:v',str(max(1,min(args.frames,300))),str(Path(temporary)/'%05d.png')],check=True)
            frames=sorted(Path(temporary).glob('*.png'));box=args.box
            with Image.open(frames[0]) as image:template=crop(image.convert('RGB'),box,2,128)[0]
            hann=np.outer(np.hanning(18)[1:-1],np.hanning(18)[1:-1]).reshape(-1)
            for i,path in enumerate(frames):
                with Image.open(path) as image:search,size,x,y=crop(image.convert('RGB'),box,4,256)
                started=time.perf_counter_ns();result=compiled({'template':template,'search':search});ms=(time.perf_counter_ns()-started)/1e6
                maps={port.get_any_name():array for port,array in result.items()}
                confidence=maps['output1'].reshape(-1)*hann;best=int(np.argmax(confidence));score=float(confidence[best])
                sizes=maps['output2'].reshape(-1);offsets=maps['output3'].reshape(-1)
                cx=(best%16+offsets[best])/16;cy=(best//16+offsets[256+best])/16
                width=float(sizes[best]*size);height=float(sizes[256+best]*size)
                next_box=[max(0,float(cx*size+x-width/2)),max(0,float(cy*size+y-height/2)),min(405,float(cx*size+x+width/2)),min(720,float(cy*size+y+height/2))]
                sample={'frame':i,'time_seconds':i/15,'inference_ms':ms,'score':score,'box':next_box}
                area=(next_box[2]-next_box[0])*(next_box[3]-next_box[1]);prior=(box[2]-box[0])*(box[3]-box[1])
                if score<.2 or width<8 or height<8 or area<64 or not .35<=area/prior<=2.5:
                    sample['lost']=True;report['samples'].append(sample);break
                report['samples'].append(sample);box=next_box
        report.update(state='inference_completed',inferences=len(report['samples']))
        times=sorted(s['inference_ms'] for s in report['samples'])
        report['median_inference_ms']=times[len(times)//2] if times else None
        report['limitation']='Inference latency excludes browser encoding, transport, preprocessing and independently annotated tracking accuracy.'
    args.output.parent.mkdir(exist_ok=True,parents=True);args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k!='samples'},ensure_ascii=False,indent=2))


if __name__=='__main__':main()
