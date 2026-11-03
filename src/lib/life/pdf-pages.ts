import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {fetchPublicPdfBytes} from './sources.ts';
import {retrieveTaskPassages} from '../agent/kernel/retrieval.ts';
import type {AcquiredDocument} from './acquisition.ts';
import {AgentError} from '../agent/contracts.ts';
import {modelMentioned} from './knowledge.ts';

/** Actual page index, not guessed page numbers from a flattened text offset. */
export async function readPdfPageIndex(url:string,model:string){
 const source=await fetchPublicPdfBytes(url),{PDFParse}=await import('pdf-parse'),parser=new PDFParse({data:source.bytes});
 try{
  const text=await parser.getText({first:80});
  if(!modelMentioned(text.text,model))throw new AgentError('当前PDF内容未确认本次型号，未上传图示');
  return {pageCount:text.total,pageIndex:text.pages.map(p=>({page:p.num,text:p.text.replace(/\s+/g,' ').slice(0,260)})),sourceHash:createHash('sha256').update(source.bytes).digest('hex')};
 }finally{await parser.destroy();}
}

/** Render real pages with the already installed pdf-parse. No OCR guess or
 * invented figure URL; keep original page numbers and a byte digest. */
export async function renderRelevantPdf(url:string,query:string,anchor:string,requested:number[]=[],model?:string){
 const source=await fetchPublicPdfBytes(url);
 return renderPdfPages(source.bytes,source.url,query,anchor,requested,model);
}
export async function renderPdfPages(bytes:Uint8Array,url:string,query:string,anchor:string,requested:number[]=[],model?:string){
 if(bytes.length>12_000_000||Buffer.from(bytes).subarray(0,5).toString()!=='%PDF-')throw new AgentError('PDF无效或过大');
 const {PDFParse}=await import('pdf-parse'),parser=new PDFParse({data:bytes});
 try{
  const text=await parser.getText({first:80});
  if(model&&!modelMentioned(text.text,model))throw new AgentError('当前PDF内容未确认本次型号，未上传图示');
  if(requested.some(n=>!Number.isInteger(n)||n<1||n>Math.min(80,text.total))||requested.length>3)throw new AgentError('页码不在已读取PDF范围，单次最多读取3页');
  const chunks=text.pages.map(p=>({id:'pdf-page:'+p.num,documentId:'pdf',title:'page '+p.num,text:p.text,start:p.num,end:p.num,url,model:''}));
  // Reuse the existing passage selector; this ranks pages, not product facts.
  const selected=requested.length?[...new Set(requested)]:retrieveTaskPassages([{id:'pdf',chunks} as AcquiredDocument],[query,anchor],[],Number.MAX_SAFE_INTEGER).slice(0,3).map(p=>p.start);
  if(!selected.length)throw new AgentError('未能定位PDF页面，不把空白当作读图成功');
  const rendered=await parser.getScreenshot({partial:selected,desiredWidth:1200,imageDataUrl:false});
  const pages=await Promise.all(rendered.pages.map(async p=>{
   const image=await sharp(p.data).jpeg({quality:55}).toBuffer();
   return {page:p.pageNumber,dataUrl:'data:image/jpeg;base64,'+image.toString('base64')};
  }));
  if(pages.reduce((n,p)=>n+Buffer.byteLength(p.dataUrl),0)>600000)throw new AgentError('所选页面图像过大，请缩小到具体页后重试');
  return {pages,pageCount:text.total,sourceHash:createHash('sha256').update(bytes).digest('hex'),url,selection:'requested_or_existing_passage_selector_not_semantic_proof' as const};
 }finally{await parser.destroy();}
}
