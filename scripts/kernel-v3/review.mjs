// Engineering review decisions, NOT model scores and NOT an external blind test.
// Counts follow the old historical questionCoverage rubric; published answers only.
import fs from 'node:fs';import {createHash} from 'node:crypto';
const root='docs/engineering/intelligence-kernel-v3-2026-10-31/evidence';
const read=n=>JSON.parse(fs.readFileSync(root+'/'+n+'.json','utf8'));
// id: [V3 correct core units, direct correct core units, V3 observed unsupported/wrong expansion, direct observed unsupported/wrong expansion, note]
const historical={
 'QA-01':[1,2,false,true,'V3有2秒开机；首次自动配对被误拒。直接臂扩写充电等。'],
 'QA-02':[2,2,true,true,'双方核心5秒及设备选择可读；V3错误扩为自动播放，直接臂按钮描述自相矛盾。'],
 'QA-03':[2,2,false,true,'短按减音量、长按切曲均覆盖；直接臂加无证据的专用按钮排除说法。'],
 'QA-04':[1,2,false,true,'V3走原确定性安全路由0上游，未给湿耳机专项来源；直接臂补造2–4小时。'],
 'QA-05':[0,0,false,true,'V3未知但未解释逻辑；直接臂先说缺席不能否定，随后用缺席、硬件猜测断言。'],
 'QA-06':[1,2,true,true,'两臂均编保修责任/行业政策；V3拒拆修后仍从经销商措辞推免责。最终代码有必要政策来源门禁，非本批全量重跑。'],
 'QA-07':[4,4,false,true,'V3四项关键按键已答，未继续设备端选中；直接臂称单独蓝牙按键。关键项4/4不等于完整配对任务。'],
 'QA-08':[1,2,false,true,'V3只答IP67，防水被拦；直接臂加了未给出处的海水冲洗等。'],
 'QA-09':[0,1,false,true,'Boost资料未进输入；V3没保留已有12小时，直接臂据缺席反驳15小时。'],
 'QA-10':[0,0,true,true,'两臂都把缺席当不支持立体声/Auracast；直接臂再混PartyBoost。'],
 'QA-11':[2,2,false,true,'1节AA正确；直接臂添加无USB充电等未核验扩展。'],
 'QA-12':[2,2,true,true,'接收器与非蓝牙核心正确，附加无模块/无菜单等不是所引规格的证明。'],
 'QA-13':[1,1,true,true,'A+适合新手，但默认图文指南、HDR/景深等扩展未逐项证明。'],
 'QA-14':[2,2,true,true,'传手机与遥控核心覆盖；具体参数/远程变焦等扩展未核实。'],
 'QA-15':[1,2,true,true,'V3旋转亮度被误拒，色温动作有但添顺逆时针/呼吸说法；直接臂旋钮位置猜错。'],
 'QA-16':[0,1,false,true,'V3把2.4GHz与无据5GHz否定捆绑后全挡；直接臂否定依据仍是缺席。'],
 'QA-17':[0,0,false,true,'正文未取得。V3明确缺资料；直接臂随后给同类机型清洗/空机加热猜测。'],
 'QA-18':[1,2,true,true,'V3在另一段保留未批准食品接触但主问误拒，另添加法规；直接臂混未批准与没通过认证。'],
 'QA-19':[1,2,true,true,'V3有锚固原文，却扩未核法规/条件；直接臂扩承重墙、固定配件和评论事实。'],
 'QA-20':[1,2,false,true,'V3只给170–290g，漏宽厚；直接臂给宽厚但添电机及配重负载解释。'],
 'QA-21':[0,1,true,true,'FAQ空壳，不得把无IP声明当雨淋许可/否定证明；V3扩热稳定性解释。'],
 'CONSTRAINT-01':[0,2,false,true,'V3超时；直接臂核心不夹相机正确，但手机夹范围和磁吸条件混乱。'],
 'CONSTRAINT-02':[0,2,false,true,'V3答宽厚必要计算，却丢关键310g超限判定；直接臂答对核心但加夹具/其他型号未核说法。'],
 'CONSTRAINT-03':[1,0,false,true,'V3承认净格未知且不保证兼容；直接臂编35–36/17–18cm及塞得进。'],
 'CONSTRAINT-04':[0,0,false,true,'V3正确食品禁忌被误拒；直接臂警告后仍推荐短时腌菜/酱汁和无据温时限，不能按前半段算正确。'],
 'CONSTRAINT-05':[0,1,false,true,'V3几乎全挡；直接臂未声称已控制，但套平台/精确参数。'],
 'CONSTRAINT-06':[0,1,false,true,'V3超时；直接臂拍照方向有价值但混无频闪保证和未证支撑等。'],
 'CONSTRAINT-07':[0,0,false,true,'V3超时；直接臂用外尺寸除二、弹性/用户实测保证适配。'],
 'CONSTRAINT-08':[0,1,false,true,'V3超时；直接臂有IP67但OM6雨天推断与额外资源未充分依据。'],
 'CONSTRAINT-09':[0,0,true,true,'V3仍发布内壁光滑/无卡槽的缺席推断；直接臂把分离盒盖想成铰链支撑。'],
 'PERSONA-03':[0,0,true,true,'均未获真实关系故事。V3用产品资料推个人熟悉感/过去表达，直接臂更虚构旅行/孩子。'],
 'PERSONA-07':[0,1,true,true,'V3大段AR/OCR假设而非现有分身帮助，且断言零IoT；直接臂混未来可实现与现功能。'],
 'FAMILY-10':[1,1,true,true,'V3有锚固资料却漏立即停止加重；直接臂有停止但给未证固定件/墙体操作。'],
 'AGENT-02':[2,2,false,true,'V3回答1节AA，直接臂又扩镍氢/锂铁兼容。']
};
// Holdout is frozen and has NOT been used to tune product rules. Eligible units
// mean answerable with the captured official corpus; correct unknowns separate.
const holdout={
 'H-SONY-PX470-1':[2,1,2,2,true,true,'V3遗漏AAA电池；USB连接有依据，但RECORD路径不在输入章节。'],
 'H-SONY-PX470-2':[1,0,0,0,false,true,'供电≠充电；V3泛未知未解释，直接臂凭缺席否定。'],
 'H-SONY-PX470-3':[2,1,1,1,true,true,'V3直连方向但添未测试结论且未完成避错；直接臂猜USB不供电。'],
 'H-SONY-PX470-4':[2,0,1,0,true,true,'V3编设备不能删除/无权限功能且无选择性分享方案；直接臂有分离思路但有无据按键/能力断言。'],
 'H-SONY-PX470-5':[2,0,0,0,false,true,'V3超时；LEGO正文缺失，直接臂仍称结构已官方确认并指导搬动。'],
 'H-CANON-CP1500-1':[3,3,3,3,false,false,'光面/18张/内关外开均对；属于真实成功。'],
 'H-CANON-CP1500-2':[2,2,2,2,false,true,'V3两项均正确；直接臂把最多18写成严格18，并扩丢弃剩余空白纸。'],
 'H-CANON-CP1500-3':[2,1,1,1,true,true,'两臂过度推专用介质的原理/涂层等；V3未直接完整答替代条件。'],
 'H-CANON-CP1500-4':[2,1,2,0,false,true,'当前只装纸章，电源未知；V3保留未知但未讲USB角色，直接臂又猜具体电压风险。'],
 'H-CANON-CP1500-5':[2,0,1,0,true,true,'V3参数/元数据长篇假设，没有做出选择性共享；直接臂NFC/PNG等越界扩展。'],
 'H-LOGI-K380-1':[2,1,2,2,true,true,'V3漏短按对应通道；不重配核心有，设备可发现不是已配对切换的必要条件。'],
 'H-LOGI-K380-2':[3,3,3,3,true,true,'两节AAA核心对；V3加不可充电电池/USB断言，直接臂还误称K380s/K580可USB充电。需细查接口证据。'],
 'H-LOGI-K380-3':[2,1,2,2,true,true,'V3有短按但未预配设备；直接臂提供预配置，附加不需设置等需界定首次条件。'],
 'H-LOGI-K380-4':[2,0,1,0,true,true,'V3混Options+唯一自定义路径及未知打印能力；直接臂称CP1500蓝牙打印/伪引快捷键。'],
 'H-LOGI-K380-5':[2,1,1,1,true,true,'V3解释短按非配对但无有效新路径；直接臂错把按钮说成循环通道并猜地址冲突。'],
 'H-IKEA-RASKOG-1':[2,0,2,2,false,true,'V3架构/生成失败；直接臂尺寸材料答对却多编食品许可、四轮都锁等。'],
 'H-IKEA-RASKOG-2':[2,1,2,1,false,true,'V3保留净尺寸缺失但没给明确稳定性结论；直接臂说明不保证同时编无围挡。'],
 'H-IKEA-RASKOG-3':[2,1,2,1,false,true,'V3没承诺可坐，却未直接给载荷非载人判断；直接臂正确原则与未核标准条款混用。'],
 'H-IKEA-RASKOG-4':[2,0,1,1,false,true,'V3超时；直接臂有移动工作站但加用户没有的耗材/工具。'],
 'H-IKEA-RASKOG-5':[2,0,1,1,true,true,'V3复述6kg未改变摆法；直接臂重物下置方向有，但补造网架无围挡/结构原因。'],
 'H-LEGO-42179-1':[2,0,0,0,false,true,'应用无正文，V3保留未知不能算事实覆盖；直接臂无正文仍补公开知识。'],
 'H-LEGO-42179-2':[2,0,0,0,false,true,'无正文；V3未完成教学，直接臂套太阳部件/手推运动操作。'],
 'H-LEGO-42179-3':[2,0,0,0,false,true,'无正文；V3未有可体验玩法，直接臂编无电机/接口及精确传动观察。'],
 'H-LEGO-42179-4':[2,1,1,1,true,true,'V3保留联接未知但虚构EOS R50机身结构结论；直接臂说明缺连接承载，额外设备并非当前可做。'],
 'H-LEGO-42179-5':[2,1,1,0,true,true,'V3故事仅占位模板，不算已保存/修好；直接臂有停硬转但添维护周期和免费补件政策。'],
 'H-MI-PURIFIER4-1':[3,3,3,1,false,true,'尺寸有据、材质/频段单独未知，V3成功保留部分；直接臂又说Smart必支持米家。'],
 'H-MI-PURIFIER4-2':[2,1,2,0,true,true,'无10分钟完全净化依据；V3核心问仍未直接答且编标准普遍条款，直接臂亦加未给标准。'],
 'H-MI-PURIFIER4-3':[2,0,0,0,false,true,'V3全未知未完成夜间安排；直接臂编5秒关LED、33–36dBA和每米6dB。'],
 'H-MI-PURIFIER4-4':[2,0,0,1,false,true,'V3超时；直接臂用外框/总高度保证任意层稳定，属明显物理条件错误。'],
 'H-MI-PURIFIER4-5':[3,3,3,0,true,false,'清洗/水洗/费用均未知可分别答；V3仍夹H13 HEPA+活性炭无来源。']
};
const old=JSON.parse(fs.readFileSync('docs/engineering/real-intelligence-2026-10-31/evidence/case-reviews.json','utf8')).rows;
const rows=[];
for(const [stage,judgments]of [['historical-final-v3',historical],['holdout-frozen-v1',holdout]]){
 const raw=read(stage);
 for(const [id,j]of Object.entries(judgments))for(const arm of ['v3','direct']){
  const r=raw.rows.find(r=>r.id===id&&r.arm===arm);if(!r)throw Error('review_missing_raw');
  const hist=stage==='historical-final-v3',total=hist?+old.find(r=>r.id===id&&r.arm==='wujian').questionCoverage.split('/')[1]:j[0];
  const correct=hist?j[arm==='v3'?0:1]:j[arm==='v3'?1:2],unverified=!!j[hist?(arm==='v3'?2:3):(arm==='v3'?4:5)];
  const unavailable=!!r.error||r.result?.reply?.outcome==='unavailable';
  const complete=correct===total&&!unverified&&!unavailable&&!(hist&&id==='QA-07');
  rows.push({id,arm,stage,reviewer:'Codex_AI_source_output_review_not_independent_human',correctCoreUnits:correct,totalCoreUnits:total,
   officialAnswerableUnits:hist?null:j[3],observedUnsupportedExpansion:unverified,taskStatus:complete?'pass':unavailable?'unavailable':correct?'partial':'fail',
   note:j.at(-1),outputRef:stage+'.json#'+id+'/'+arm,question:r.question,sourceStatus:r.sourceStatus,fullReturnedAnswerMs:r.elapsedMs,fullEffectiveAnswerMs:complete?r.elapsedMs:null,upstreamRequests:r.upstreamRequests,
   inputTokens:r.inputTokens,outputTokens:r.outputTokens,estimatedCny:r.estimatedCny,commit:raw.commit,kernelSourceHash:raw.kernelSourceHash});
 }
}
const q=(a,p)=>{if(!a.length)return null;a=[...a].sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.ceil(p*a.length)-1)];};
const metrics=[];
for(const stage of ['historical-final-v3','holdout-frozen-v1'])for(const arm of ['v3','direct']){
 const a=rows.filter(r=>r.stage===stage&&r.arm===arm),returned=a.map(r=>r.fullReturnedAnswerMs),effective=a.filter(r=>r.taskStatus==='pass').map(r=>r.fullEffectiveAnswerMs);
 metrics.push({stage,arm,tasks:a.length,correctCoreUnits:a.reduce((n,r)=>n+r.correctCoreUnits,0),totalCoreUnits:a.reduce((n,r)=>n+r.totalCoreUnits,0),
   pass:a.filter(r=>r.taskStatus==='pass').length,partial:a.filter(r=>r.taskStatus==='partial').length,unavailable:a.filter(r=>r.taskStatus==='unavailable').length,
   observedUnsupportedExpansionTasks:a.filter(r=>r.observedUnsupportedExpansion).length,returnedMs:{p50:q(returned,.5),p95:q(returned,.95)},effectivePassedMs:{n:effective.length,p50:q(effective,.5),p95:q(effective,.95)},
   upstreamRequests:a.reduce((n,r)=>n+(r.upstreamRequests||0),0),inputTokens:a.reduce((n,r)=>n+(r.inputTokens||0),0),outputTokens:a.reduce((n,r)=>n+(r.outputTokens||0),0),estimatedCny:a.reduce((n,r)=>n+(r.estimatedCny||0),0)});
}
fs.writeFileSync(root+'/v3-case-reviews.json',JSON.stringify({rubric:'发布的关键项覆盖与完整任务、无据扩展分开；同旧历史rubric，非全主张真值穷尽审核。留出新题关键项由问题/冻结rubric分解，来源缺失不算事实已答；officialAnswerableUnits只是当前语料可答估计。没有外部独立真人盲评或现实物理验证。',metrics,rows},null,2)+'\n');
const calls=read('model-calls').attempts,stats={roundId:read('authorization').roundId,requests:calls.length,cap:250,capEstimatedCny:50,statusCounts:{},inputTokens:0,outputTokens:0,estimatedOrReservedCny:0,unknownUsage:[],byEvaluationStage:{}};
for(const a of calls){stats.statusCounts[a.status]=(stats.statusCounts[a.status]||0)+1;stats.inputTokens+=a.tokens?.prompt_tokens||0;stats.outputTokens+=a.tokens?.completion_tokens||0;stats.estimatedOrReservedCny+=a.estimatedCny??a.reservedCny;const stage=(a.evaluation||'preview-unlabeled').split('/')[0];stats.byEvaluationStage[stage]=(stats.byEvaluationStage[stage]||0)+1;if(!a.tokens)stats.unknownUsage.push(a.number);}
fs.writeFileSync(root+'/model-summary.json',JSON.stringify(stats,null,2)+'\n');
const samples=[],key=[];for(const r of rows){const raw=read(r.stage).rows.find(x=>x.id===r.id&&x.arm===r.arm);const sid=createHash('sha256').update(r.stage+'/'+r.id+'/'+r.arm).digest('hex').slice(0,12);samples.push({sampleId:sid,taskId:r.id,question:r.question,answer:raw.result?.reply?.answer||raw.result?.text||raw.error,physicalVerification:false});key.push({sampleId:sid,stage:r.stage,arm:r.arm,outputRef:r.outputRef});}
samples.sort((a,b)=>a.sampleId.localeCompare(b.sampleId));fs.writeFileSync(root+'/blind-samples.jsonl',samples.map(s=>JSON.stringify(s)).join('\n')+'\n');fs.writeFileSync(root+'/blind-key.json',JSON.stringify(key,null,2)+'\n');
console.log(JSON.stringify({metrics,budget:stats},null,2));
