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
  ["快门","shutter button","shutter"],
  ["录像","视频","短片","movie recording","recording movies"],
  ["回放","播放","movie playback","playback"],
  ["兼容","规格","compatible","specifications"],
] as const;
/** Navigation ranking only. Fetching a chapter still requires exact model checks. */
export function relevantManualLinks(question:string,links:{title:string;url:string}[]){
 const q=question.toLowerCase(),groups=topics.filter(g=>g.some(t=>q.includes(t)));
 const score=(title:string,g:readonly string[])=>g.reduce((n,t)=>n+(title.toLowerCase()===t?30:title.toLowerCase().includes(t)?t.length:0),0);
 const ordered=[...groups].sort((a,b)=>Math.min(...a.filter(t=>q.includes(t)).map(t=>q.indexOf(t)))-Math.min(...b.filter(t=>q.includes(t)).map(t=>q.indexOf(t))));
 const first=ordered.flatMap(g=>links.map(l=>({l,score:score(l.title,g)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,1).map(x=>x.l));
 const rest=links.map(l=>({l,score:groups.reduce((n,g)=>n+score(l.title,g),0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).map(x=>x.l);
 return [...first,...rest].filter((l,n,a)=>a.findIndex(x=>x.url===l.url)===n);
}
export function multilingualAnchors(question:string,chunks:KnowledgeChunk[]) {
  const q=question.toLowerCase();
  return topics.filter(group=>group.some(t=>q.includes(t))).flatMap(group=>{
    // A dedicated chapter outranks a contents page that merely lists the same terms.
    // This selects passages; it does not certify any claim made from them.
    const ranked=chunks.map(c=>({c,score:group.reduce((n,t)=>n+Number(c.text.toLowerCase().includes(t))+3*Number(c.title.toLowerCase().includes(t)),0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
    return ranked.slice(0,2).map(x=>x.c);
  }).filter((c,i,all)=>all.findIndex(x=>x.id===c.id)===i);
}
