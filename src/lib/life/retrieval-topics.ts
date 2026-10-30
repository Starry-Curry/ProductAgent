import type { KnowledgeChunk } from "./acquisition.ts";
// Query expansion only, never intent routing or a source of product facts.
const topics = [
  ["配对","连接","蓝牙","pairing","connect","bluetooth"],
  ["初始化","恢复出厂","initialize","initializing","factory settings"],
  ["重置","复位","resetting","reset"],
  ["充电","charging","charge"],
  ["电池","battery","alkaline"],
  ["材质","材料","material","polypropylene"],
  ["尺寸","宽度","高度","dimensions","width","height","thickness"],
  ["重量","承重","weight","load"],
  ["食品接触","食品","food contact"],
  ["保修","维修","售后","warranty","repair","service"],
  ["清洁","清洗","cleaning","clean","wash"],
] as const;
export function multilingualAnchors(question:string,chunks:KnowledgeChunk[]) {
  const q=question.toLowerCase();
  return topics.filter(group=>group.some(t=>q.includes(t))).flatMap(group=>{
    const ranked=chunks.map(c=>({c,score:group.reduce((n,t)=>n+Number(c.text.toLowerCase().includes(t)),0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
    return ranked.slice(0,2).map(x=>x.c);
  }).filter((c,i,all)=>all.findIndex(x=>x.id===c.id)===i);
}
