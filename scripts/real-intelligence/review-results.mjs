import fs from 'node:fs';
import {createHash} from 'node:crypto';
const dir='docs/engineering/real-intelligence-2026-10-31/evidence';
const load=n=>JSON.parse(fs.readFileSync(dir+'/'+n+'.json','utf8'));
const ledger=load('model-calls');
const stages=['first-eight-v2','remaining-26-v1','retarget-v1'];
const plan=JSON.parse(fs.readFileSync('docs/engineering/experience-lifecycle-2026-10-31/evidence/live-evaluation-plan.json','utf8')).cases;
// Engineering review of recorded outputs and official sources, NOT another LLM score.
// Tuple: factual verdict, coverage n/total, task status, observed issue.
const w={
 'QA-01':['correct','2/2','pass','2秒开机、首次自动配对。'],
 'QA-02':['correct','2/2','pass','后续配对5秒及设备选择步骤。'],
 'QA-03':['unanswered','0/2','fail','资料有短按/长按区别，有限原子索引未覆盖。'],
 'QA-04':['correct_limited','1/2','partial','本地安全停用；没有明确针对湿耳机给出处。物间上游0次，不能称真实模型回答。'],
 'QA-05':['correct_unknown','1/1','pass','修复null后明确证据不足；不能从未提及推否定。'],
 'QA-06':['correct_unknown','1/3','partial','未编造政策，但未知项合并为未覆盖提问，拆修风险/保修覆盖仍不清楚。'],
 'QA-07':['correct','4/4','pass','开机、暂停、音量、再次配对均覆盖。'],
 'QA-08':['unanswered','0/2','fail','QSG有相关防护文字但PDF图标受损，索引又不覆盖，未回答。'],
 'QA-09':['unanswered','0/3','blocked_source','产品页未取到，QSG仅有12小时；Boost资料未在该模型快照中取得。'],
 'QA-10':['unanswered','0/2','blocked_source','QSG图示不足以完成连接模式语义问答；不能据未提及否定。'],
 'QA-11':['correct','2/2','partial','1节AA正确，但多拆一个battery_count后又说未知，令人困惑。'],
 'QA-12':['unanswered','0/2','fail','已有接收器N/A字段，但模型选的谓词与有限索引不匹配。'],
 'QA-13':['unanswered','0/2','fail','型号产品页有场景模式；协议/有限索引退回无关摘录。'],
 'QA-14':['unanswered','0/2','fail','有来源仍被有限字段挡住，没完成手机联动问答。'],
 'QA-15':['unanswered','0/2','fail','最初被当事实字段问答，无旋钮属性索引。真实B旅程的操作路径已另外复测。'],
 'QA-16':['unanswered','0/1','fail','官方规格2.4GHz存在，但有限字段没覆盖。'],
 'QA-17':['unanswered','0/1','blocked_source','支持页跨站跳转未读到正文；4次模型请求后仍不可用，属于检索失败叠加调用浪费。'],
 'QA-18':['correct','1/2','partial','明确未批准食品接触；没给替代容器原则。'],
 'QA-19':['unanswered','0/2','fail','有官方锚固警告，却未能利用。'],
 'QA-20':['correct','2/2','pass','170—290g，且不把重量满足当完整兼容。'],
 'QA-21':['unanswered','0/2','blocked_source','应用FAQ只取到31字符空壳。网页工具另能读NZ站，不能冒充已进入模型输入。'],
 'CONSTRAINT-01':['unanswered','0/2','fail','单物品上下文/原子投影没完成相机与手机云台兼容任务。'],
 'CONSTRAINT-02':['correct_limited','1/2','partial','复述170—290g，但没有明确完成310g超限判断。'],
 'CONSTRAINT-03':['unanswered','0/2','blocked_scope','只选盒子进入单物品上下文，缺另一件物品净格证据。'],
 'CONSTRAINT-04':['correct','1/2','partial','拒绝食品用途的事实正确，未给合适替代路线。'],
 'CONSTRAINT-05':['unanswered','0/2','fail','原子路径不适合带授权前提的自动化规划。'],
 'CONSTRAINT-06':['unanswered','0/3','fail','事实路径截断跨物品任务；另见真实开放创意旅程，其物理机制仍失败。'],
 'CONSTRAINT-07':['unanswered','0/3','fail','没组织净尺寸、稳定和现有资源；不是HTTP失败。'],
 'CONSTRAINT-08':['unanswered','0/2','blocked_source','DJI防水FAQ未取到，JBL来源不完整，又退回摘录。'],
 'CONSTRAINT-09':['unanswered','0/2','fail','不能仅用原子索引完成稳定性条件推理。'],
 'PERSONA-03':['unanswered','0/2','fail','没有虚构经历，但未自然解释当前缺少本人故事。'],
 'PERSONA-07':['unanswered','0/2','fail','答食品接触，未回答数字身份能提供什么帮助。'],
 'FAMILY-10':['unanswered','0/2','fail','倾倒状态没进入有效安全处置，暴露路由与关键条件断点。'],
 'AGENT-02':['correct','2/2','pass','一轮完成1节AA事实，没绕REA或创造流程。'],
};
const d={
 'QA-01':['unverified_expansion','2/2','partial','核心开机正确，扩写充电/App自定义按键及状态细节未逐主张有据。'],
 'QA-02':['wrong_inference','2/2','partial','核心5秒正确；附带短按电源确认开机等无据/错误指导。'],
 'QA-03':['correct','2/2','pass','核心短按减音量、长按上一首正确；附带重置措辞另需区分初始化。'],
 'QA-04':['wrong_inference','2/2','partial','正确阻止湿态充电；编出2—4小时、IPX0和清洁剂等结论。'],
 'QA-05':['wrong_inference','0/1','fail','先说不能从缺席否定，后又以未出现特性为不支持的证据。'],
 'QA-06':['wrong_inference','0/3','fail','一拆即失保、通常不修电池、费用比、12小时充电等均未获所给政策支持。'],
 'QA-07':['wrong_inference','4/4','partial','四问覆盖但额外宣称再次配对必须开机不能关机，及无据状态/方向。'],
 'QA-08':['unverified_expansion','2/2','partial','IP67核心正确；冲洗/盐水维护政策未在逐案资料核对中证实。'],
 'QA-09':['wrong_inference','2/3','fail','明确否定15小时/Boost，说第三方误传。后续独立官方规格核对反驳了该结论。'],
 'QA-10':['wrong_inference','0/2','fail','错误否定双机立体声/Auracast并改称PartyBoost。'],
 'QA-11':['wrong_inference','2/2','partial','数量规格正确，追加无据的充电电池不兼容结论。'],
 'QA-12':['unverified_expansion','2/2','partial','接收器结论有依据；扩大为全地区Unifying/不卖替换接收器等政策。'],
 'QA-13':['unverified_expansion','2/2','partial','A+/SCN有据，但加入模式/菜单路径等未在本轮证据确认的细节。'],
 'QA-14':['unverified_expansion','2/2','partial','传图与遥控核心成立，扩写照片删除、遥控全部参数等未核。'],
 'QA-15':['scope_overreach','2/2','partial','亮度/色温动作正确，却扩展为全球所有地区适用及未核参数。'],
 'QA-16':['correct','1/1','pass','2.4GHz有直接规格依据。'],
 'QA-17':['correct_unknown','1/1','blocked_source','明确没有此型号清洗正文；随后通用流程不算该型号验收完成。'],
 'QA-18':['unverified_expansion','2/2','partial','未批准食品接触判断正确；额外认证标识/法规结论无资料支持。'],
 'QA-19':['unverified_expansion','2/2','partial','锚固要求正确；多国强制标准及墙体细则未在提供来源核对。'],
 'QA-20':['wrong_inference','2/2','partial','重量正确，却说说明书未列宽厚；实际同一V1.8手册有67—84mm/6.9—10mm。'],
 'QA-21':['wrong_inference','1/2','partial','避雨方向合理，但依据是手册没提防水、猜USB无胶塞；不等于官方明确反驳。'],
 'CONSTRAINT-01':['unverified_expansion','1/2','partial','拒绝直接夹相机方向正确；无任意第三方适配器等市场断言无据。'],
 'CONSTRAINT-02':['wrong_inference','1/2','partial','310>290判断正确；对宽厚范围继续猜测且说说明书未列。'],
 'CONSTRAINT-03':['wrong_inference','0/2','fail','擅换KALLAX型号，编造39.5cm净格并保证可放。'],
 'CONSTRAINT-04':['unverified_expansion','2/2','partial','食品接触拒绝正确，列出未经资料确认的认证/品牌适用性。'],
 'CONSTRAINT-05':['unverified_expansion','2/2','partial','没声称已执行，但配网长按/平台与设备必要条件未核。'],
 'CONSTRAINT-06':['wrong_inference','0/3','fail','把PP盒称亚克力、1S换成Pro、编造支架和额外白纸。'],
 'CONSTRAINT-07':['wrong_inference','0/3','fail','外框推净格、虚构多层与额外器材、胶带/纸板材料。'],
 'CONSTRAINT-08':['not_returned','0/2','fail','上游finish_reason=length，应用正确拒绝当作完整回答；不是事实正确通过。'],
 'CONSTRAINT-09':['wrong_inference','1/2','partial','以未设计/未提及推不可行，未给载荷/重心却断言必然倾倒。'],
 'PERSONA-03':['wrong_inference','0/2','fail','未提供故事，仍写出用户过去的摄影心境和被物品记得的经历。'],
 'PERSONA-07':['wrong_inference','1/2','fail','3个14cm盒高被写为92cm，并虚构当前3D能力/退货政策。'],
 'FAMILY-10':['wrong_inference','1/2','fail','方向有安全意识，却虚构未固定即不在保修、配件和墙体政策。'],
 'AGENT-02':['wrong_inference','2/2','partial','电池核心正确；附加充电电池不支持等无据结论，短问长答。'],
};
const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const rows=[];
for(const c of plan){let stage,wr,dr;
 for(const s of stages){const rs=load(s).rows;const a=rs.find(r=>r.id===c.id&&r.arm==='wujian');if(a){stage=s;wr=a;dr=rs.find(r=>r.id===c.id&&r.arm==='direct');}}
 const first=ledger.attempts.find(a=>a.evaluation===stage+'/'+c.id+'/wujian'),direct=ledger.attempts.find(a=>a.evaluation===stage+'/'+c.id+'/direct');
 const payload=a=>a?.input?.find(m=>m.role==='user')?.content;
 const parity=first&&direct?hash(JSON.parse(payload(first)))===hash(JSON.parse(payload(direct))):null;
 for(const [arm,r,review]of [['wujian',wr,w[c.id]],['direct',dr,d[c.id]]]){
  const calls=ledger.attempts.filter(a=>a.evaluation===stage+'/'+c.id+'/'+arm);
  rows.push({id:c.id,question:c.prompt,expected:c.expected,arm,stage,reviewer:'engineering_source_review_not_human_blind',factVerdict:review[0],questionCoverage:review[1],taskStatus:review[2],reviewNote:review[3],wrongInference:review[0]==='wrong_inference',sameFirstUserPayload:parity,comparableSingleUpstream:calls.length===1&&wr.upstreamCalls===1&&parity===true,fullReturnedAnswerMs:r.elapsedMs,fullEffectiveAnswerMs:review[2]==='pass'?r.elapsedMs:null,modelRequests:calls.length,tokens:{input:calls.reduce((n,a)=>n+(a.tokens?.prompt_tokens||0),0),output:calls.reduce((n,a)=>n+(a.tokens?.completion_tokens||0),0)},estimatedCny:calls.reduce((n,a)=>n+(a.estimatedCny??a.reservedCny),0),outputRef:stage+'.json#'+c.id+'/'+arm,retrievalStage:review[2].startsWith('blocked')?'source_or_context_gap':'see_source_fetch_and_payload',experienceUse:'not_provided_in_base34; separate_real_journeys'});
 }
}
const summary={roundId:ledger.task,requests:ledger.attempts.length,reportedUsageRequests:ledger.attempts.filter(a=>a.tokens).length,unknownUsageRequests:ledger.attempts.filter(a=>!a.tokens).length,inputTokens:ledger.attempts.reduce((n,a)=>n+(a.tokens?.prompt_tokens||0),0),outputTokens:ledger.attempts.reduce((n,a)=>n+(a.tokens?.completion_tokens||0),0),estimatedCnyKnown:ledger.attempts.reduce((n,a)=>n+(a.estimatedCny||0),0),reservedCnyUnknown:ledger.attempts.filter(a=>a.estimatedCny===undefined).reduce((n,a)=>n+a.reservedCny,0),models:[...new Set(ledger.attempts.map(a=>a.model))],returnedModels:[...new Set(ledger.attempts.filter(a=>a.returnedModel).map(a=>a.returnedModel))],uniqueCases:plan.length,physicalTests:0,humanBlindReview:'pending',arms:{}};
for(const arm of ['wujian','direct']){const a=rows.filter(r=>r.arm===arm),covers=a.map(r=>r.questionCoverage.split('/').map(Number));summary.arms[arm]={reviewedCases:a.length,factVerdicts:a.reduce((o,r)=>(o[r.factVerdict]=(o[r.factVerdict]||0)+1,o),{}),tasks:a.reduce((o,r)=>(o[r.taskStatus]=(o[r.taskStatus]||0)+1,o),{}),criticalFactCaseCorrectRate:{numerator:a.filter(r=>r.factVerdict==='correct'||r.factVerdict==='correct_unknown').length,denominator:a.length,meaning:'案级有限核心事实/未知判断满足率；不是所有主张的正确率，也不是创造力评分'},questionCoverage:{covered:covers.reduce((n,x)=>n+x[0],0),total:covers.reduce((n,x)=>n+x[1],0)},observedWrongInferenceCases:a.filter(r=>r.wrongInference).length};}
fs.writeFileSync(dir+'/case-reviews.json',JSON.stringify({rubric:'关键事实正确/未知判断、所问覆盖、无据扩展与完成程度分开；未进行全主张真值穷尽审核。所有创意质量仅工程审阅，独立真人盲评未完成。',rows},null,2));
fs.writeFileSync(dir+'/summary.json',JSON.stringify(summary,null,2));
let md='# 34案逐案工程复核\n\n不是模型自评分，也不是独立真人盲评。按原任务expected核心事实与所问子问题审阅；扩写未证实与已发现错误分开标注。覆盖率不能证明事实正确，拒答也不能算完成。资料为空与推理失误见备注。取QA-05/06/11定向复测，其余保留首轮；不是把整个34案冒充最终源码一次性回归。默认路径另见default-eight-v1与gate-fixed-v1。\n\n| 案例 | 物间关键事实/覆盖/完成 | 直接千问关键事实/覆盖/完成 | 物间断点 | 对照断点 |\n|---|---|---|---|---|\n';
for(const c of plan){const a=rows.find(r=>r.id===c.id&&r.arm==='wujian'),b=rows.find(r=>r.id===c.id&&r.arm==='direct');md+=`| ${c.id} | ${a.factVerdict}; ${a.questionCoverage}; ${a.taskStatus} | ${b.factVerdict}; ${b.questionCoverage}; ${b.taskStatus} | ${a.reviewNote} | ${b.reviewNote} |\n`;}
fs.writeFileSync('docs/engineering/real-intelligence-2026-10-31/CASE_REVIEW.md',md);
const blind=[],key=[];
for(const c of plan){const a=rows.find(r=>r.id===c.id&&r.arm==='wujian'),b=rows.find(r=>r.id===c.id&&r.arm==='direct');const arms=[a,b].sort((x,y)=>hash(c.id+x.arm).localeCompare(hash(c.id+y.arm)));const sample=arms.map((r,n)=>{const row=load(r.stage).rows.find(x=>x.id===c.id&&x.arm===r.arm);const label=String.fromCharCode(65+n);key.push({id:c.id,label,arm:r.arm,stage:r.stage});return {label,answer:row.result?.reply?row.result.reply.answer+'\n'+row.result.reply.steps.map(s=>s.text).join('\n'):row.result?.text||row.error,review:{useful:null,grounded:null,complete:null,notes:''}};});blind.push({id:c.id,question:c.prompt,productIds:c.product_ids,sourcePool:'same recorded first payload; hash parity in case-reviews.json',samples:sample});}
fs.writeFileSync(dir+'/blind-samples.jsonl',blind.map(x=>JSON.stringify(x)).join('\n')+'\n');fs.writeFileSync(dir+'/blind-key.json',JSON.stringify(key,null,2));
// Independent necessary-condition counterexamples, not another model judging itself.
const T=20,RH=60,alpha=Math.log(RH/100)+17.62*T/(243.12+T),dewpoint=243.12*alpha/(17.62-alpha);
const physical={method:'确定性反例+官方规格核对，未进行实物试验，不构成完整物理仿真',checks:[{claim:'加热室温PP盒会自然形成凝结纹理',assumptions:{ambientC:T,relativeHumidity:RH,initialSurfaceC:T,heatedSurfaceC:24},dewpointC:dewpoint,belowDewpoint:false,conclusion:'此普通环境反例中加热后仍高于露点，不能支持草稿承诺；实际湿度/温度未知。'},{claim:'3个14cm盒叠放达92cm',computedHeightCm:3*14,claimedHeightCm:92,conclusion:'直接模型样本PERSONA-07的算术错误。'},{claim:'310g手机可用OM6',officialRangeG:[170,290],reportedWeightG:310,excessG:310-290,conclusion:'超过官方重量范围，尺寸满足也不能认定兼容。'},{claim:'旋钮已试用证明倒置铰链可悬空稳定',basis:'没有质量、重心、支撑点、锁止和载荷证据',conclusion:'个人操作报告不证明另一机械能力，不能放行为可执行结构。'}]};
fs.writeFileSync(dir+'/independent-condition-checks.json',JSON.stringify(physical,null,2));
console.log(JSON.stringify(summary));
