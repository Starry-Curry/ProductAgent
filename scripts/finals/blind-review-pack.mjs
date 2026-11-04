import fs from 'node:fs';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';import {ROOT} from './gateway.mjs';
const out=ROOT+'/blind-review-pack-r1.md',key=ROOT+'/blind-review-key-r1.json';assert.ok(!fs.existsSync(out)&&!fs.existsSync(key));
const probe=JSON.parse(fs.readFileSync(ROOT+'/model-config-probe-r1.json')),ledger=JSON.parse(fs.readFileSync(ROOT+'/model-calls.json'));
const sha=s=>createHash('sha256').update(s).digest('hex');const map=[];
let text='# 已有真实输出的匿名审阅包\n\n这是本轮已经发生的8次模型配置实验，只重排、隐去配置名和改变排版，没有新增模型请求，没有修正原句，也不是外部真人评分结果。对应关系另存 blind-review-key-r1.json，请评分后再看。\n\n请分别判断：解决需要、物理/操作原理、未持有资源、个人条件利用、事实/假设区分、表达和愿意尝试程度。可标“无法判断”，不要因为字多或引用多给高分。\n\n';
for(const caseId of [...new Set(probe.cases.map(c=>c.caseId))]){
 const rows=probe.cases.filter(c=>c.caseId===caseId).map(c=>({c,order:sha(caseId+'|'+c.config+'|blind-review-r1')})).sort((a,b)=>a.order.localeCompare(b.order));
 const original=ledger.attempts.find(a=>a.number===rows[0].c.originalRequest);assert.ok(original&&Array.isArray(original.input));const context=JSON.parse(original.input.find(m=>m.role==='user').content);
 text+='## '+caseId+'\n\n共同问题：'+context.question+'\n\n共同物品（模拟持有）：'+context.items.map(i=>i.name+' / '+i.identity.brand+' / '+i.identity.model).join('；')+'。\n\n共同私人条件均为获准合成设定：'+JSON.stringify({preferences:context.preferences,experiences:context.experiences,privateFacts:context.privateFacts})+'\n\n完整相同资料见 model-calls.json 原始请求 '+original.number+'，其输入哈希 '+original.inputSha256+'；本包不重新复制整份厂家原文。\n\n';
 rows.forEach(({c},n)=>{
  const label=caseId+'-'+String.fromCharCode(65+n);map.push({label,config:c.config,model:c.model,thinkingBudget:c.thinkingBudget,originalRequest:c.originalRequest,inputSha256:c.inputSha256,rawOutputSha256:sha(JSON.stringify({text:c.text,toolCalls:c.toolCalls}))});
  text+='### 样本 '+label+'\n\n';if(c.error){text+='原始失败：'+c.error+'\n\n';return;}
  if(c.text)text+=c.text+'\n\n';
  for(const call of c.toolCalls||[]){const p=JSON.parse(call.function.arguments);if(p.message)text+=p.message+'\n\n';const g=p.guidance||p;if(g.goal)text+='目标：'+g.goal+'\n\n';if(g.steps)text+=g.steps.map((s,n)=>(n+1)+'. '+(typeof s==='string'?s:s.text)+(typeof s==='object'&&s.conditions?.length?'\n   原始条件：'+s.conditions.join('；'):'')).join('\n\n')+'\n\n';if(g.conditions?.length)text+='原始共同条件：\n\n'+g.conditions.map(c=>'- '+c).join('\n')+'\n\n';text+='原始工具提交（核对语义/结构时展开；合法ID不等于正确）：\n\n<details><summary>原始参数，未修正</summary>\n\n```json\n'+call.function.arguments+'\n```\n\n</details>\n\n';}
  text+='评价：□有价值 □无价值 □条件不足；明确错误：____；愿意尝试的部分：____。\n\n';
 });
}
fs.writeFileSync(out,text);fs.writeFileSync(key,JSON.stringify({at:new Date().toISOString(),basis:'mapping_only_not_quality_scores',samples:map},null,2));console.log(JSON.stringify({samples:map.length,paidRequests:0,output:out}));
