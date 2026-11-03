import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { renderPdfPages } from '../src/lib/life/pdf-pages.ts';
import { createProvider } from '../src/lib/ai/provider.ts';

// Generated public-document substitute. No downloaded manual, real account,
// model, DNS lookup or physical-device operation is involved in these tests.
const sourceUrl='https://helpguide.sony.net/synthetic/five-page-manual.pdf';
function syntheticPdf() {
 const texts=[
  'TEST-PDF Cover and contents.',
  'PAIRING Bluetooth marked key for five seconds. Synthetic diagram on this page.',
  'Cleaning dry cloth. Do not disassemble.',
  'Charging USB cable. Confirm power conditions.',
  'Warranty scope unknown. End of synthetic manual.',
 ];
 const fontId=3+texts.length*2;
 const objects:Buffer[]=[
  Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
  Buffer.from(`<< /Type /Pages /Kids [${texts.map((_,i)=>`${3+i*2} 0 R`).join(' ')}] /Count ${texts.length} >>`),
 ];
 for(const [i,text] of texts.entries()){
  const content=`${(i+1)/10} 0.2 0.5 rg 40 40 ${45+i*12} 35 re f\nBT /F1 14 Tf 30 220 Td (${text}) Tj ET`;
  objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 650 260] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${4+i*2} 0 R >>`));
  objects.push(Buffer.from(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`));
 }
 objects.push(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'));
 let bytes=Buffer.from('%PDF-1.4\n');const offsets:number[]=[];
 for(const [index,object] of objects.entries()){
  offsets.push(bytes.length);bytes=Buffer.concat([bytes,Buffer.from(`${index+1} 0 obj\n`),object,Buffer.from('\nendobj\n')]);
 }
 const xref=bytes.length;
 return Buffer.concat([bytes,Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.map(n=>String(n).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Root 1 0 R /Size ${objects.length+1} >>\nstartxref\n${xref}\n%%EOF`)]);
}

test('真实PDF按相关文字定位页并渲染JPEG，只保留最多3页和原始物理页码',async()=>{
 const bytes=syntheticPdf();
 const selected=await renderPdfPages(bytes,sourceUrl,'PAIRING Bluetooth','marked key for five seconds');
 assert.equal(selected.pageCount,5);assert.equal(selected.url,sourceUrl);
 assert.equal(selected.sourceHash,createHash('sha256').update(bytes).digest('hex'));
 assert(selected.pages.length>0&&selected.pages.length<=3);
 assert(selected.pages.some(p=>p.page===2),'配对文字实际在第二页，不能选封面冒充相关图示');
 for(const page of selected.pages){
  assert(Number.isInteger(page.page)&&page.page>=1&&page.page<=5);assert.match(page.dataUrl,/^data:image\/jpeg;base64,/);
  const image=Buffer.from(page.dataUrl.split(',')[1],'base64'),metadata=await sharp(image).metadata();
  assert.equal(metadata.format,'jpeg');assert.equal(metadata.width,1200);assert((metadata.height||0)>0);
 }
 const explicit=await renderPdfPages(bytes,sourceUrl,'unrelated query','', [4,2,2]);
 assert.deepEqual(explicit.pages.map(p=>p.page).sort((a,b)=>a-b),[2,4]);
 assert.equal(explicit.pages.find(p=>p.page===2)!.dataUrl,selected.pages.find(p=>p.page===2)!.dataUrl,'渲染确实来自同一个物理页，而非只改页码标签');
 assert.notEqual(explicit.pages[0].dataUrl,explicit.pages[1].dataUrl,'不同页面的实际图形/文字必须不同');
});

test('PDF页码越界/小数/超过3页及无效PDF明确拒绝，不把缺页当读取成功',async()=>{
 const bytes=syntheticPdf();
 for(const pages of [[0],[6],[-1],[1.5],[1,2,3,4]])
  await assert.rejects(renderPdfPages(bytes,sourceUrl,'pairing','',pages),/页码|最多读取3页/);
 await assert.rejects(renderPdfPages(Buffer.from('not a PDF'),sourceUrl,'pairing','',[1]),/PDF无效/);
 await assert.rejects(renderPdfPages(Buffer.from('%PDF-1.4\ncorrupt body without pages'),sourceUrl,'pairing','',[1]));
 const oversized=Buffer.alloc(12_000_001);oversized.write('%PDF-1.4');
 await assert.rejects(renderPdfPages(oversized,sourceUrl,'pairing','',[1]),/PDF无效或过大/);
});

test('SDK实际传所选页images和页码，不把整本PDF作为file再次发送（离线HTTP替身）',async()=>{
 const rendered=await renderPdfPages(syntheticPdf(),sourceUrl,'pairing','',[2,4]);
 let requests=0;const bodies:any[]=[];
 const provider=createProvider({AI_BASE_URL:'https://dashscope.aliyuncs.com/compatible-mode/v1',AI_API_KEY:'synthetic-not-a-secret',AI_MODEL:'qwen-plus',AI_ALLOW_PAID_CALLS:'true',WUJIAN_ALLOW_PAID_CALLS:'true'},async(url,init)=>{
  requests++;assert.equal(new URL(String(url)).hostname,'dashscope.aliyuncs.com');const body=JSON.parse(String(init?.body));bodies.push(body);
  return Response.json({id:'offline-page-reading',model:'qwen-plus',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:'合成第2页有配对文字；图示本身未进行真实产品核验。'}}],usage:{prompt_tokens:20,completion_tokens:10}});
 });
 const result=await provider.inspectDocument!(sourceUrl,'核对配对示意图','pdf',{pages:rendered.pages});
 assert.equal(requests,1);assert.deepEqual(result.tokens,{input:20,output:10});assert.match(result.text,/合成第2页/);
 const content=bodies[0].messages.find((m:any)=>m.role==='user').content;
 assert.equal(content.filter((p:any)=>p.type==='image_url').length,2);
 assert.deepEqual(content.filter((p:any)=>p.type==='image_url').map((p:any)=>p.image_url.url),rendered.pages.map(p=>p.dataUrl));
 assert(content.some((p:any)=>p.type==='text'&&p.text.includes('原始来源：'+sourceUrl)));
 for(const page of rendered.pages)assert(content.some((p:any)=>p.type==='text'&&p.text==='原PDF物理页码：'+page.page));
 assert(!content.some((p:any)=>p.type==='file'));assert(!JSON.stringify(bodies[0]).includes('file_url'));
});
