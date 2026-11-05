import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {fetchPublicPdfBytes} from './sources.ts';
import {retrieveTaskPassages} from '../agent/kernel/retrieval.ts';
import type {AcquiredDocument} from './acquisition.ts';
import {AgentError} from '../agent/contracts.ts';
import {modelMentioned} from './knowledge.ts';
import {localOCR} from './documents.ts';

const coverScopes=new Map<string,{basis:'local_cover_ocr_not_semantic_proof';page:1}>();
/** Some manuals draw their cover model as outlines: useful body text exists
 * but the model is absent from the text layer. Read the actual cover locally,
 * never accept a filename or caller-provided supported=true as identity. */
async function checkPdfModel(parser:import('pdf-parse').PDFParse,text:string,model:string|undefined,hash:string){
 if(!model)return {basis:'model_not_requested' as const};
 if(modelMentioned(text,model))return {basis:'model_in_pdf_text_layer' as const};
 const key=hash+'\n'+model,cached=coverScopes.get(key);if(cached)return cached;
 const cover=await parser.getScreenshot({partial:[1],desiredWidth:1600,imageDataUrl:false});
 if(cover.pages.length!==1)throw new AgentError('未取得PDF首页，未确认本次型号');
 const observed=await localOCR(cover.pages.map(p=>p.data));
 if(!modelMentioned(observed,model))throw new AgentError('当前PDF文字及首页OCR未确认本次型号，未上传图示');
 const scope={basis:'local_cover_ocr_not_semantic_proof' as const,page:1 as const};
 if(coverScopes.size>=12)coverScopes.delete(coverScopes.keys().next().value!);coverScopes.set(key,scope);
 return scope;
}

/** Actual page index, not guessed page numbers from a flattened text offset. */
export async function readPdfPageIndex(url:string,model:string){
 const source=await fetchPublicPdfBytes(url),{PDFParse}=await import('pdf-parse'),parser=new PDFParse({data:source.bytes});
 try{
  const text=await parser.getText({first:80});
  const sourceHash=createHash('sha256').update(source.bytes).digest('hex'),modelScope=await checkPdfModel(parser,text.text,model,sourceHash);
  return {pageCount:text.total,pageIndex:text.pages.map(p=>({page:p.num,text:p.text.replace(/\s+/g,' ').slice(0,260)})),sourceHash,modelScope};
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
  const sourceHash=createHash('sha256').update(bytes).digest('hex'),modelScope=await checkPdfModel(parser,text.text,model,sourceHash);
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
  return {pages,pageCount:text.total,sourceHash,modelScope,url,selection:'requested_or_existing_passage_selector_not_semantic_proof' as const};
 }finally{await parser.destroy();}
}
