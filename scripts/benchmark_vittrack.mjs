/** Optional browser benchmark: no cloud/API calls, no real webcam access.
 * node scripts/benchmark_vittrack.mjs BASE_URL FRAME_DIRECTORY XYWH_TXT OUTPUT_JSON
 * Requires @playwright/test and an installed Chromium browser (or BROWSER_PATH).
 * FRAME_DIRECTORY contains lexically ordered JPEG frames, e.g. OTB Car4/img.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [base,framesDirectory,annotations,output]=process.argv.slice(2);
if(!output)throw new Error('Usage: node scripts/benchmark_vittrack.mjs BASE_URL FRAME_DIRECTORY XYWH_TXT OUTPUT_JSON');
const frames=path.resolve(framesDirectory),names=fs.readdirSync(frames).filter(n=>/\.jpe?g$/i.test(n)).sort();
const truth=fs.readFileSync(annotations,'utf8').trim().split(/\r?\n/).map(line=>line.trim().split(/[\s,]+/).map(Number));
if(names.length!==truth.length||truth.some(v=>v.length!==4||v.some(n=>!Number.isFinite(n))))throw new Error('Frames and XYWH annotations must correspond one-to-one');
const {chromium}=createRequire(path.join(root,'frontend/package.json'))('@playwright/test');
const server=http.createServer((req,res)=>{
 const index=Number(req.url.slice(1));
 if(!Number.isInteger(index)||index<0||index>=names.length){res.writeHead(404);res.end();return;}
 res.setHeader('Access-Control-Allow-Origin',new URL(base).origin);res.setHeader('Content-Type','image/jpeg');
 fs.createReadStream(path.join(frames,names[index])).pipe(res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
const report={created_at:new Date().toISOString(),model:'OpenCV Zoo ViTTrack / ORT WASM CPU',physical_camera_used:false,cloud_calls:0};
try{
 const page=await browser.newPage();await page.goto(base);
 const asset='/assets/'+fs.readdirSync(path.join(root,'frontend/dist/assets')).find(n=>n.startsWith('vitTracker-')&&n.endsWith('.js'));
 report.result=await page.evaluate(async({asset,truth,port})=>{
  const {VitTracker,loadVitTrack}=await import(asset);await loadVitTrack();
  const canvas=document.createElement('canvas'),g=canvas.getContext('2d',{willReadFrequently:true});
  const load=async i=>{const image=new Image();image.crossOrigin='anonymous';image.src=`http://127.0.0.1:${port}/${i}`;await image.decode();
    if(i===0){canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;}g.drawImage(image,0,0);};
  await load(0);const first=truth[0],tracker=await VitTracker.create(canvas,[first[0],first[1],first[0]+first[2],first[1]+first[3]]);
  const samples=[];let failure=null;
  const overlap=(a,b)=>{const area=Math.max(0,Math.min(a[2],b[0]+b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[1]+b[3])-Math.max(a[1],b[1]));return area/((a[2]-a[0])*(a[3]-a[1])+b[2]*b[3]-area||1);};
  try{for(let i=1;i<truth.length;i++){await load(i);try{const value=await tracker.update(canvas);samples.push({frame:i,iou:overlap(value.box,truth[i]),ms:value.ms,box:value.box,score:value.score});}catch(e){failure={frame:i,message:e.message};break;}}}finally{tracker.dispose();}
  const sorted=samples.map(v=>v.iou).sort((a,b)=>a-b),times=samples.map(v=>v.ms).sort((a,b)=>a-b);
  return {frames:samples.length,median_iou:sorted[Math.floor(sorted.length/2)]??0,mean_iou:sorted.reduce((a,b)=>a+b,0)/(sorted.length||1),
    success_iou_50:samples.filter(v=>v.iou>=.5).length/(samples.length||1),median_ms:times[Math.floor(times.length/2)],p95_ms:times[Math.floor(times.length*.95)],
    failure,initialization:'Only the first annotated box; no oracle reinitialization',samples};
 },{asset,truth,port});
 console.log(JSON.stringify({...report,result:{...report.result,samples:undefined}}));
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));}
