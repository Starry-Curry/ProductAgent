import OpenAI from 'openai';import {z} from 'zod';
export const RERANK_MODEL='qwen3.7-text-rerank';
export const rerankRequest=z.object({model:z.literal(RERANK_MODEL),input:z.object({query:z.string().trim().min(1).max(1000),documents:z.array(z.string().min(1).max(1800)).min(1).max(96)}).strict(),parameters:z.object({top_n:z.number().int().min(1).max(16),instruct:z.literal('Given a web search query, retrieve relevant passages that answer the query.')}).strict()}).strict().superRefine((v,c)=>{
 const bound=Buffer.byteLength(v.input.query)*v.input.documents.length+v.input.documents.reduce((n,s)=>n+Buffer.byteLength(s),0);
 if(bound>100000)c.addIssue({code:'custom',message:'排序输入超过有界原文预算'});
 if(v.parameters.top_n>v.input.documents.length)c.addIssue({code:'custom',message:'返回数量大于候选数量'});
});
export type RerankResult={indices:number[];scores:number[];model:string;tokens:{input:number;output:0}|null};
/** Maintained SDK transport; ranking never creates facts or permissions. */
export async function qwenRerank(env:Record<string,string|undefined>,request:typeof fetch,query:string,documents:string[],topN=12):Promise<RerankResult>{
 if(env.AI_ALLOW_PAID_CALLS!=='true'||env.WUJIAN_ALLOW_PAID_CALLS!=='true'||env.AI_RERANK_MODEL!==RERANK_MODEL)throw Error('rerank_not_authorized_or_configured');
 const base=new URL(env.AI_BASE_URL||'');if(base.protocol!=='https:'||base.hostname!=='dashscope.aliyuncs.com'||base.username||base.password||base.search||base.pathname.replace(/\/$/,'')!=='/compatible-mode/v1')throw Error('rerank_configuration_not_verified');
 const body=rerankRequest.parse({model:RERANK_MODEL,input:{query,documents},parameters:{top_n:Math.min(topN,documents.length),instruct:'Given a web search query, retrieve relevant passages that answer the query.'}});
 const client=new OpenAI({apiKey:env.AI_API_KEY,baseURL:new URL('/api/v1',base).href,fetch:request,maxRetries:0,timeout:12000,fetchOptions:{redirect:'error'}}),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);timer.unref();
 try{
  const raw:any=await client.post('/services/rerank/text-rerank/text-rerank',{body,signal:controller.signal});
  if(raw.code)throw Error('rerank_provider_rejected');
  const result=z.array(z.object({index:z.number().int().min(0).max(documents.length-1),relevance_score:z.number().min(0).max(1)})).min(1).max(body.parameters.top_n).parse(raw.output?.results);
  if(new Set(result.map(r=>r.index)).size!==result.length)throw Error('rerank_duplicate_indices');
  const input=raw.usage?.prompt_tokens??raw.usage?.total_tokens;
  return {indices:result.map(r=>r.index),scores:result.map(r=>r.relevance_score),model:RERANK_MODEL,tokens:Number.isSafeInteger(input)&&input>=0?{input,output:0}:null};
 }finally{clearTimeout(timer);}
}
