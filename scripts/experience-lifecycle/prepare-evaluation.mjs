import fs from 'node:fs';
const origin='docs/engineering/unified-foundation-v2-2026-10-30',out='docs/engineering/experience-lifecycle-2026-10-31/evidence';
if(process.argv.includes('--run'))throw Error('本任务未授权新增付费请求。此脚本只冻结评测输入，不调用模型。');
const suite=fs.readFileSync(origin+'/package/wujian_realworld_acceptance_v1.jsonl','utf8').trim().split('\n').map(JSON.parse);
const prior=fs.readFileSync(origin+'/evidence/acceptance-results.jsonl','utf8').trim().split('\n').map(JSON.parse);
const rows=suite.map(c=>({id:c.id,mode:c.mode,status:c.mode==='live_model'?'blocked_model_budget':'not_run',historicalStatus:prior.find(r=>r.id===c.id)?.status,method:'pending_current_round_case_execution',actual_result:c.mode==='live_model'?'未获本任务付费授权，未执行。其他模式另见本轮定向旅程记录，不沿用历史通过为新通过。':'旧版曾执行结果仅为历史参考，本轮不自动认证该逐案状态。',evidence_ref:'../../unified-foundation-v2-2026-10-30/evidence/acceptance-results.jsonl',verified_by:'not_executed_in_this_matrix'}));
fs.writeFileSync(out+'/acceptance-status.jsonl',rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
const live=suite.filter(c=>c.mode==='live_model');
fs.writeFileSync(out+'/live-evaluation-plan.json',JSON.stringify({preparedAt:new Date().toISOString(),execution:'blocked_model_budget',paidCalls:0,cases:live,
 comparison:{arms:['物间当前版','直接调用同款千问'],identical:['同一型号/地区来源快照','同一用户报告与限制','同一获准经验','同一问题','同一模型版本'],report:['完整有效回答耗时，不以首字计','所有失败和重试次数','实际input/output tokens','逐主张依据、缺证和冲突','人工匿名双盲样本与失败原因']},
 proposedFirstGate:{representativeCases:8,caseIds:["QA-02","QA-05","QA-06","QA-07","QA-11","QA-18","CONSTRAINT-01","PERSONA-07"],pairedOutputs:16,maxPaidRequestsIncludingFailures:24,maxInputTokensPerRequest:6000,maxOutputTokensPerRequest:1500,estimatedMaximumInputTokens:144000,estimatedMaximumOutputTokens:36000,requestedSpendCapCny:5,approved:false,note:'这是请求上限建议，不是报价或已获授权。执行前须核对当时账户模型价格/接口，按先达到的请求或费用上限停止。余下26案待首组达标再申请。'},
 rubric:{hardFailures:['无证据功能否定','编造价格/保修','错型号/地区/固件','撤权/遗忘资料泄露','虚构现实动作已完成'],humanReview:['解决实际需求','建议条件是否充分','自然完整','创造性与实际价值，由真人判断'],notProof:['模型自评','HTTP200','替身返回','引用ID合法']}
},null,2));
console.log(JSON.stringify({cases:rows.length,blockedLive:live.length,paidCalls:0}));
