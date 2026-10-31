import { quoteInSource } from "../../skills/document-help.ts";
import { hazardousActions,withoutProhibitedActions } from "../safety-language.ts";
import type { Candidate,ClaimCheck,TaskFrame } from "./contracts.ts";
import { reviewSchema } from "./contracts.ts";
import type { KernelContext } from "./context.ts";
import type { z } from "zod";
import {rangeCondition} from './physical.ts';

/** One fabricated/reformatted extra quotation must not erase independently valid
 * evidence. Exclude the bad citation explicitly; still require semantic review of
 * the complete claim against the surviving originals. No fuzzy ID matching. */
export function anchorCandidate(c:Candidate,context:KernelContext){
  const excluded:{id:string;quote:string;reason:string}[]=[];
  const sources=c.sources.flatMap(r=>{
    const s=context.evidence.find(s=>s.id===r.id);
    const applicable=!!s&&(s.basis!=='official'||c.itemIds.includes(s.itemId)&&context.items.some(i=>i.id===s.itemId&&i.model===s.model));
    if(!applicable){excluded.push({...r,reason:'来源不存在或不适用当前物品，未用于核对'});return [];}
    if(!quoteInSource(s!.text,r.quote)){
      excluded.push({...r,reason:'候选引文不精确，已撤下；核对器另读服务器保存的完整原始段落，不将候选引文视为证据'});
      return [{id:r.id,quote:s!.text}];
    }
    return [r];
  });return {candidate:{...c,sources},excluded};
}

/** Recognize generic range comparisons without a brand/property registry. Operands
 * must already appear with units in this question and the cited adjacent range. */
export function attachRangeDerivation(c:Candidate,frame:TaskFrame){
  if(c.calculation||!['fact','advice'].includes(c.kind))return c;
  for(const ref of c.sources){
    const ranges=[...normalized(ref.quote).matchAll(/(\d+(?:\.\d+)?)\s*[-–—~至到]\s*(\d+(?:\.\d+)?)\s*(kg\b|g\b|mm\b|cm\b|公斤|千克|克|毫米|厘米)/g)];
    for(const range of ranges){
      const lower=quantities(range[1]+' '+range[3])[0],upper=quantities(range[2]+' '+range[3])[0];
      const supplied=quantities(frame.originalQuestion).filter(q=>q.unit===lower?.unit);
      const values=quantities(c.text);
      const actual=supplied.find(q=>values.some(v=>v.unit===q.unit&&v.value===q.value));
      if(!actual||!lower||!upper)continue;
      const calculation={kind:'range' as const,actual:actual.value,min:lower.value,max:upper.value,unit:actual.unit,sourceId:ref.id,quote:ref.quote,inputQuote:frame.originalQuestion,assertion:(actual.value>=lower.value&&actual.value<=upper.value?'within':'outside') as 'within'|'outside'};
      return {...c,kind:'advice' as const,calculation};
    }
  }return c;
}

export function verifyCalculation(candidate:Candidate,frame:TaskFrame,context:KernelContext){
  const c=candidate.calculation;if(!c)return undefined;
  const source=context.evidence.find(s=>s.id===c.sourceId&&s.basis==='official'&&candidate.itemIds.includes(s.itemId));
  if(!source||!quoteInSource(source.text,c.quote)||!frame.originalQuestion.includes(c.inputQuote))throw Error('计算操作数缺少本轮原文或用户报告');
  const bounds=quantities(c.quote),actual=quantities(c.inputQuote);
  const qty=(n:number)=>quantities(n+' '+c.unit)[0];
  const lo=qty(c.min),hi=qty(c.max),value=qty(c.actual);
  if(!lo||!hi||!value||!bounds.some(q=>q.unit===lo.unit&&q.value===lo.value)||!bounds.some(q=>q.unit===hi.unit&&q.value===hi.value)||!actual.some(q=>q.unit===value.unit&&q.value===value.value))throw Error('计算数值或单位与原文不一致');
  // Bound values appearing somewhere in a page are not a range. Keep the actual
  // adjacent interval and its unit as the source of this deterministic rule.
  const intervals=[...normalized(c.quote).matchAll(/(\d+(?:\.\d+)?)\s*[-–—~至到]\s*(\d+(?:\.\d+)?)\s*([a-z]+|公斤|千克|克|毫米|厘米|米|秒|分钟|小时|度)/g)];
  if(!intervals.some(m=>{const a=quantities(m[1]+' '+m[3])[0],b=quantities(m[2]+' '+m[3])[0];return a?.unit===lo.unit&&a.value===lo.value&&b?.unit===hi.unit&&b.value===hi.value;}))throw Error('原文没有所声明的相邻范围及单位');
  const result=rangeCondition(value.value,lo.value,hi.value);
  if(result.satisfied!==(c.assertion==='within'))throw Error('范围推导与确定性计算相反');
  return result;
}

function normalized(s:string){
  const english=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve'];
  return s.normalize('NFKC').toLowerCase().replace(new RegExp('\\b('+english.join('|')+')\\b','g'),w=>String(english.indexOf(w)))
    .replace(/\b(\d+)\s*[x×]?\s*(aaa?)\b/g,'$1节 $2')
    .replace(/([一二两三四五六七八九十]+)(?=秒|分钟|小时|节|个|厘米|毫米|克)/g,w=>w==='十'?'10':String('零一二三四五六七八九'.indexOf(w.replace('两','二'))));
}
/** Numeric consistency is necessary, not semantic proof. Model identifiers are removed
 * by the caller. Dimensions/units are compared in canonical units, not string equality. */
export function quantities(s:string){
  return [...normalized(s).matchAll(/(\d+(?:\.\d+)?)(?:\s*[-–—~至到]\s*(\d+(?:\.\d+)?))?\s*(kg\b|g\b|公斤|千克|克|mm\b|cm\b|m\b|毫米|厘米|米|seconds?\b|secs?\b|秒|minutes?\b|mins?\b|分钟|hours?\b|小时|ghz\b|mhz\b|v\b|伏|w\b|瓦|℃|°\s*c|摄氏度|度|ml\b|l\b|毫升|升|%|节|个)/g)].flatMap(m=>{
    const u=m[3].replace(/\s/g,'');
    const [unit,factor]= /^(kg|公斤|千克)$/.test(u)?['g',1000]:/^(g|克)$/.test(u)?['g',1]:/^(mm|毫米)$/.test(u)?['mm',1]:/^(cm|厘米)$/.test(u)?['mm',10]:/^(m|米)$/.test(u)?['mm',1000]:/^(minute|min|分钟)/.test(u)?['s',60]:/^(hour|小时)/.test(u)?['s',3600]:/^(second|sec|秒)/.test(u)?['s',1]:/^(ghz)$/.test(u)?['mhz',1000]:/^(mhz)$/.test(u)?['mhz',1]:/^(l|升)$/.test(u)?['ml',1000]:/^(ml|毫升)$/.test(u)?['ml',1]:/^(v|伏)$/.test(u)?['v',1]:/^(w|瓦)$/.test(u)?['w',1]:/c|℃|度/.test(u)?['c',1]:[u,1];
    return [m[1],...(m[2]?[m[2]]:[])].map(n=>({value:Number(n)*Number(factor),unit:String(unit)}));
  });
}
export function precheck(candidate:Candidate,frame:TaskFrame,context:KernelContext):string[]{
  const reasons:string[]=[];
  try{verifyCalculation(candidate,frame,context);}catch(e){reasons.push((e as Error).message);}
  const part=frame.parts.find(p=>p.id===candidate.partId);
  if(!part)reasons.push('候选不属于当前子问题');
  if(candidate.itemIds.some(id=>!context.items.some(i=>i.id===id)))reasons.push('引用了未读取或未获准的物品');
  const quotes=candidate.sources.map(s=>s.quote).join('\n');
  // Necessary epistemic constraints, independent of the review model's approval.
  // They do not claim general semantic entailment or replace the source audit.
  const absent=/未提及|没有提及|没有证据|无证据|未出现|未列|没写|not mentioned|not listed/i;
  const negative=/不支持|不能|无法|不具备|没有.{0,12}(?:功能|模块|能力)|无.{0,8}(?:功能|能力)/;
  if(candidate.kind!=='user_report'&&absent.test(candidate.text)&&negative.test(candidate.text)&&!/不等于|不代表|不能(?:证明|据此|认定)|不足以/.test(candidate.text))reasons.push('不能用未提及或缺少证据推出明确否定');
  const warrantyClaim=/保修|免责|失保|保修责任|warranty|refund/i.test(candidate.text);
  if(candidate.kind!=='user_report'&&warrantyClaim&&!/保修|warranty|guarantee|refund|return policy|免修|免责/i.test(quotes))reasons.push('保修或责任主张缺少适用的官方政策原文；维修联系指引不等于保修政策');
  if(part?.kind==='relationship'&&candidate.kind!=='hypothesis'&&!candidate.sources.some(r=>context.evidence.some(s=>s.id===r.id&&s.basis!=='official')))reasons.push('产品说明不能证明用户曾经的经历、情感或人物关系');
  const requiresOfficial=candidate.kind==='fact'||candidate.kind==='operation'||!!part&&['fact','procedure'].includes(part.kind)&&candidate.kind==='advice'&&!candidate.calculation;
  if(requiresOfficial){
    if(!candidate.sources.length)reasons.push('型号事实或操作缺少原文');
    if(!candidate.itemIds.length)reasons.push('型号事实缺少明确物品主体');
  }
  for(const ref of candidate.sources){
    const s=context.evidence.find(s=>s.id===ref.id);
    if(!s||!quoteInSource(s.text,ref.quote)){reasons.push('原文引用不存在或已改变：'+ref.id);continue;}
    if(s.basis==='official'&&(!candidate.itemIds.includes(s.itemId)||!context.items.some(i=>i.id===s.itemId&&i.model===s.model)))reasons.push('来源主体或型号不适用');
    if(requiresOfficial&&s.basis!=='official')reasons.push('用户报告不能认证厂家性能或操作');
  }
  const official=candidate.sources.map(r=>context.evidence.find(s=>s.id===r.id)).filter(s=>s?.basis==='official');
  if(candidate.kind==='user_report'&&!candidate.sources.some(r=>context.evidence.some(s=>s.id===r.id&&s.basis!=='official')))reasons.push('个人经历缺少本轮获准报告');
  if(requiresOfficial){
    let text=candidate.text;
    for(const i of context.items)if(i.model)text=text.replaceAll(i.model,'');
    const supplied=quantities(candidate.sources.filter(r=>official.some(s=>s?.id===r.id)).map(r=>r.quote).join('\n'));
    for(const q of quantities(text))if(!supplied.some(x=>x.unit===q.unit&&Math.abs(x.value-q.value)<1e-7))reasons.push('数值/单位超出所引原文：'+q.value+q.unit);
  }
  const reports=candidate.experienceIds.map(id=>context.experiences.find(r=>r.outcomeId===id));
  if(reports.some(r=>!r))reasons.push('经验已失效或本轮未获准');
  if(reports.length&&!candidate.adaptation?.trim())reasons.push('引用经验却未说明本次行动如何改变');
  if(hazardousActions.test(withoutProhibitedActions(candidate.text))||/我(?:已经|已)(?:帮你|为你)?(?:修复|控制|执行|检测|配对|开启|关闭)/.test(withoutProhibitedActions(candidate.text)))reasons.push('只读回答不能执行危险操作或宣称已控制实物');
  return [...new Set(reasons)];
}
export function adjudicateCandidates(frame:TaskFrame,candidates:Candidate[],context:KernelContext,review:z.infer<typeof reviewSchema>):ClaimCheck[]{
  return candidates.map(c=>{
    const reasons=precheck(c,frame,context);
    const checks=review.checks.filter(r=>r.id===c.id);
    const check=checks.length===1?checks[0]:undefined;
    if(!check)reasons.push('没有唯一的语义核对记录');
    if(check&&check.evidenceIds.some(id=>!c.sources.some(s=>s.id===id)))reasons.push('核对器引用了候选之外的来源');
    if(check?.verdict==='entailed'&&(c.kind==='fact'||c.kind==='operation'||c.kind==='user_report')&&!check.evidenceIds.length)reasons.push('核对器未指定支持原文');
    if(check&&check.verdict!=='entailed')reasons.push(check.reason);
    if(check?.repeatsFailedAction&&(!c.changedConditions?.trim()||!c.changedConditionEvidence?.inputQuote||!frame.originalQuestion.includes(c.changedConditionEvidence.inputQuote)))reasons.push('重复已报告失败的动作，缺少本轮条件变化的明确报告');
    const conditions=[...new Set([...c.conditions,...(check?.missingConditions||[])])];
    const conditional=c.kind==='hypothesis'||conditions.length>0;
    // A missing prerequisite cannot silently turn a proven instruction into an immediate step.
    const verdict=reasons.length?(check?.verdict==='contradicted'?'refuted':check?.verdict==='conflict'?'conflicting':'insufficient'):conditional?'conditional':c.kind==='user_report'?'user_report':'supported';
    let necessaryCondition;try{necessaryCondition=verifyCalculation(c,frame,context);}catch{}
    return {id:c.id,partId:c.partId,text:c.text,verdict,published:!reasons.length,reasons,sourceIds:c.sources.map(r=>r.id),conditions,verification:'scope_quote_quantity_and_limited_semantic_review',sources:c.sources.flatMap(r=>{const s=context.evidence.find(e=>e.id===r.id);return s?[{id:s.id,quote:r.quote,url:s.url,model:s.model,region:s.region,fetchedAt:s.fetchedAt,basis:s.basis}]:[];}),necessaryCondition};
  });
}
