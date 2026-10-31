import fs from 'node:fs';
import {createHash} from 'node:crypto';
const old='docs/engineering/real-intelligence-2026-10-31/evidence/';
const out='docs/engineering/intelligence-kernel-v3-2026-10-31/evidence/';
const ledger=JSON.parse(fs.readFileSync(old+'model-calls.json'));
const specs=[
 ['A','remaining-26-v1','QA-17','官方支持页正文未取得；后续4次模型请求不能弥补缺失。'],
 ['B','journeys-v1',null,'中文调光/色温提问中英文操作的排序、引文截断及字形处理；必须区分检索与验证。'],
 ['C','remaining-26-v1','QA-20','直接模型称手册未列宽厚，但同一输入已有67–84mm及6.9–10mm。'],
 ['D','remaining-26-v1','CONSTRAINT-03','只给SAMLA的单物品投影，未调度KALLAX净格/组合条件。'],
 ['E','remaining-26-v1','QA-03','模型正确抽出短按/长按作用，但属性名不在人工索引中，全部变未知。'],
 ['F','default-eight-v1','QA-05','general标签发布无据ANC否定；修复后广泛拦截仍须改进。'],
 ['G','journeys-v2',null,'创意以金属铰链推稳定、升温推凝结；用户报告不是力学/光学证明。'],
 ['H','remaining-26-v1','QA-17','缺资料后4轮读取及修补，8.7秒仍无有效回答；HTTP与首字不算完成。'],
];
const rows=specs.map(([category,stage,id,diagnosis])=>{
 const result=JSON.parse(fs.readFileSync(old+stage+'.json'));
 const attempts=ledger.attempts.filter(a=>a.evaluation?.startsWith(stage+'/')&&(!id||a.evaluation.includes('/'+id+'/')));
 return {category,stage,caseId:id,diagnosis,resultRef:old+stage+'.json',requestRefs:attempts.map(a=>({number:a.number,label:a.evaluation,inputSha256:a.inputSha256,output:a.output,elapsedMs:a.elapsedMs})),recordShape:Object.keys(result)};
});
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(out+'root-causes.json',JSON.stringify({baseline:'4d210bcd1c820a4dec8b230693f1c95b2247743b',historicalLedgerSha256:createHash('sha256').update(fs.readFileSync(old+'model-calls.json')).digest('hex'),historicalRequests:ledger.attempts.length,review:'源码与原始输入输出工程诊断；不是新模型评测或独立盲评',rows},null,2)+'\n');
console.log('Preserved 8 root-cause groups; historical requests:',ledger.attempts.length);
