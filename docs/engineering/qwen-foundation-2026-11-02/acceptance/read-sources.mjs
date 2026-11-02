import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { PDFParse } from 'pdf-parse';
const root=path.dirname(new URL(import.meta.url).pathname.replace(/^\/(.:\/)/,'$1'));
const cache=path.join(root,'source-cache'); await fs.mkdir(cache,{recursive:true});
const sources=[
 ['bosch','https://www.bosch-professional.com/binary/manualsmedia/o356093v21_160992A5E2_202102.pdf',[22,23]],
 ['korg','https://cdn.korg.com/us/support/download/files/5e0c47682daae3d0465a5dfdc78546d4.pdf',[5,8,9]],
 ['ti','https://education.ti.com/download/en/ed-tech/50BE24C84836434485BD2E8D49374AF7/2FB7733DDAC447A4B4375E77846E1DF0/30XSMV_Guidebook_EN.pdf',[6,11]],
 ['fujifilm','https://www.instax.com/mini99/assets/pdf/manual_wwen.pdf',[9,10]],
];
const report=await Promise.all(sources.map(async([id,url,pages])=>{
 try {
 const r=await fetch(url,{signal:AbortSignal.timeout(45000)}); if(!r.ok)throw Error('HTTP '+r.status);
 const data=new Uint8Array(await r.arrayBuffer()); const bytes=data.byteLength,sha256=crypto.createHash('sha256').update(data).digest('hex'); if(bytes<100||new TextDecoder().decode(data.slice(0,5))!=='%PDF-')throw Error('Not actual PDF bytes'); await fs.writeFile(path.join(cache,id+'.pdf'),data);
 const parser=new PDFParse({data:new Uint8Array(data)}); const text=await parser.getText(); await fs.writeFile(path.join(cache,id+'.txt'),text.text);
 const images=await parser.getScreenshot({partial:pages,desiredWidth:1200});
 for(const page of images.pages)await fs.writeFile(path.join(cache,id+'-'+page.pageNumber+'.png'),page.data);
 await parser.destroy(); return {id,url,finalUrl:r.url,status:r.status,bytes,sha256,pagesRead:pages,obtainedAt:new Date().toISOString()};
 }catch(e){return{id,url,error:String(e),cause:e.cause?.code,obtainedAt:new Date().toISOString()};}
}));
await fs.writeFile(path.join(root,'source-fetch-pdf-r2.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
