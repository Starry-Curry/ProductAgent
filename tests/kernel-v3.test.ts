import test from 'node:test';
import assert from 'node:assert/strict';
import {validationFixture} from '../scripts/life-validation-fixture.ts';
import {makeKnowledgeDocument,storeOfficialDocument} from '../src/lib/life/acquisition.ts';
import {migrateUnified} from '../src/lib/foundation/schema.ts';
import {respond} from '../src/lib/agent/service.ts';
import {answerKnownItem} from '../src/lib/agent/grounded-answer.ts';
import {kernelContext,officialProductPath} from '../src/lib/agent/kernel/context.ts';
import {precheck,adjudicateCandidates,quantities,verifyCalculation,anchorCandidate,attachRangeDerivation} from '../src/lib/agent/kernel/verify.ts';
import {rangeCondition,rectangleCondition,physicalPrerequisites} from '../src/lib/agent/kernel/physical.ts';
import {saveMemory,forgetMemory} from '../src/lib/memory/store.ts';
import {retrieveTaskPassages} from '../src/lib/agent/kernel/retrieval.ts';
import {parseDraft,type Candidate,type TaskFrame} from '../src/lib/agent/kernel/contracts.ts';
import {createTask} from '../src/lib/foundation/tasks.ts';
import {mirrorItemGrant} from '../src/lib/foundation/policy.ts';

const frame:TaskFrame={version:'task-frame/3',originalQuestion:'这件东西用310g可以吗？',goal:'了解使用',itemIds:['i'],parts:[{id:'p',question:'如何使用',kind:'fact',itemIds:['i'],risk:'ordinary',needed:[],expectedResult:'回答'}],constraints:[],tried:[],evidenceIds:['s'],permission:'read_only',progress:'proposed'};
const candidate:Candidate={id:'c',partId:'p',itemIds:['i'],kind:'fact',text:'按住按钮5秒。',sources:[{id:'s',quote:'Hold the button for 5 seconds. Weight 170–290 g.'}],conditions:[],experienceIds:[]};
const context:any={items:[{id:'i',model:'NEW-MODEL'}],evidence:[{id:'s',itemId:'i',model:'NEW-MODEL',region:'us',basis:'official',text:'Hold the button for 5 seconds. Weight 170–290 g.'}],experiences:[]};
const review:any={checks:[{id:'c',verdict:'entailed',reason:'动作和时长直接见原文',evidenceIds:['s'],missingConditions:[],repeatsFailedAction:false}],omittedQuestions:[]};
test('原索引机制复现：正确陌生属性被拒；不是生成错误',async()=>{
 const result=await answerKnownItem({item:{model:'NEW-MODEL'},factDocuments:[],externalKnowledge:context.evidence} as any,{known:{},messages:[],tried:[]} as any,'如何使用',{generate:async()=>({text:JSON.stringify({claims:[{predicate:'hold_seconds',value:5}]}),model:'offline',tokens:null})} as any);
 assert.match(result.reply.answer,/证据不足|尚不足/);assert.equal(result.reply.outcome,'needs_info');
});
test('动态陌生属性不再要求品牌predicate白名单',()=>{
 assert.deepEqual(precheck(candidate,frame,context),[]);
 assert.equal(adjudicateCandidates(frame,[candidate],context,review)[0].published,true);
});
test('引用相同字句不代表语义正确：反条件由逐项核对拒绝',()=>{
 const r=adjudicateCandidates(frame,[candidate],context,{checks:[{...review.checks[0],verdict:'contradicted',reason:'原文为关机时按住，候选改成开机时'}],omittedQuestions:[]});
 assert.equal(r[0].published,false);assert.equal(r[0].verdict,'refuted');
});
test('缺失核对不能用模型自行supported放行',()=>assert.equal(adjudicateCandidates(frame,[candidate],context,{checks:[],omittedQuestions:[]})[0].published,false));
test('重复核对ID不能选择对自己有利的结果',()=>assert.equal(adjudicateCandidates(frame,[candidate],context,{...review,checks:[...review.checks,...review.checks]})[0].published,false));
test('错型号来源即使引文匹配也拒绝',()=>assert.match(precheck(candidate,frame,{...context,evidence:[{...context.evidence[0],model:'OTHER'}]}).join(),/型号/));
test('不存在引文拒绝',()=>assert.match(precheck({...candidate,sources:[{id:'s',quote:'Hold 7 seconds'}]},frame,context).join(),/引用/));
test('数值与单位变化拒绝，不能只看数字字符串',()=>{
 assert.match(precheck({...candidate,text:'按住5分钟。'},frame,context).join(),/数值/);
 assert.deepEqual(quantities('0.31 kg 310克 0.005分钟 1xAA'),[{value:310,unit:'g'},{value:310,unit:'g'},{value:0.3,unit:'s'},{value:1,unit:'节'}]);
});
test('缺项不会吞掉其他正确候选；拒绝文本及理由保留',()=>{
 const bad={...candidate,id:'bad',text:'按住10秒。'};
 const r=adjudicateCandidates(frame,[candidate,bad],context,review);
 assert.equal(r[0].published,true);assert.equal(r[1].published,false);assert.match(r[1].text,/10秒/);assert.ok(r[1].reasons.length);
});
test('来源冲突不能凭模型偏爱某一值发布',()=>assert.equal(adjudicateCandidates(frame,[candidate],context,{checks:[{...review.checks[0],verdict:'conflict',reason:'两个适用来源值冲突'}],omittedQuestions:[]})[0].verdict,'conflicting'));
test('个人报告不能证明厂家性能',()=>assert.match(precheck(candidate,frame,{...context,evidence:[{...context.evidence[0],basis:'user_report'}]}).join(),/不能认证/));
test('条件创意允许保留但不标作直接操作',()=>{
 const c={...candidate,kind:'hypothesis' as const,text:'探索盒体侧光的几何投影',conditions:['先看表面透光性质'],sources:[]};
 const r=adjudicateCandidates(frame,[c],context,{checks:[{...review.checks[0],evidenceIds:[]}],omittedQuestions:[]});
 assert.equal(r[0].published,true);assert.equal(r[0].verdict,'conditional');
});
test('经验必须改变做法；引用ID或复述不够',()=>{
 const c={...candidate,experienceIds:['e']};const ctx={...context,experiences:[{outcomeId:'e',notes:'长按失败'}]};
 assert.match(precheck(c,frame,ctx).join(),/未说明/);
 const adapted={...c,adaptation:'这次先核对已配对设备状态'};
 const r=adjudicateCandidates(frame,[adapted],ctx,{checks:[{...review.checks[0],repeatsFailedAction:true}],omittedQuestions:[]});
 assert.equal(r[0].published,false);assert.match(r[0].reasons.join(),/重复/);
});
test('伪造或已遗忘经验ID拒绝',()=>assert.match(precheck({...candidate,experienceIds:['gone'],adaptation:'换用另一路径'},frame,context).join(),/失效/));
test('范围计算实际使用用户问题与官方引文，310超过290',()=>{
 const c={...candidate,kind:'advice' as const,calculation:{kind:'range' as const,actual:310,min:170,max:290,unit:'g',sourceId:'s',quote:context.evidence[0].text,inputQuote:'310g',assertion:'outside' as const}};
 assert.equal(verifyCalculation(c,frame,context)?.satisfied,false);
 assert.match(precheck({...c,text:'310g超出范围20g，但承重100kg。'},frame,context).join(),/数值/);
 assert.throws(()=>verifyCalculation({...c,calculation:{...c.calculation,assertion:'within'}},frame,context),/相反/);
 assert.throws(()=>verifyCalculation({...c,calculation:{...c.calculation,actual:270}},frame,context),/不一致/);
});
test('二维外框不得变净空间；必要条件不证明稳定',()=>{
 assert.equal(rectangleCondition([39,28],[40,30],'external').satisfied,null);
 assert.equal(rectangleCondition([39,28],[40,30],'internal').satisfied,true);
 assert.equal(rectangleCondition([39,28],[30,40],'internal',false).satisfied,false);
 assert.equal(rangeCondition(310,170,290).excess,20);
 assert.equal(physicalPrerequisites('support',['质量']).physicallyVerified,false);
 assert.ok(physicalPrerequisites('support',['质量']).missing.includes('重心'));
});
test('字形单位匹配仍不认证完整语义，原文留在审计中',()=>{
 const r=adjudicateCandidates(frame,[candidate],context,review)[0];
 assert.equal(r.sources?.[0].quote,candidate.sources[0].quote);assert.equal(r.verification,'scope_quote_quantity_and_limited_semantic_review');
});
test('不精确候选引文撤下后另读服务器原文，不能冒充引文已匹配',()=>{
 const c={...candidate,sources:[{id:'s',quote:'Hold 7 seconds'}]};
 const anchored=anchorCandidate(c,context);
 assert.equal(anchored.excluded.length,1);assert.equal(anchored.candidate.sources[0].quote,context.evidence[0].text);
 const bad=adjudicateCandidates(frame,[{...anchored.candidate,text:'按住7秒。'}],context,review)[0];
 assert.equal(bad.published,false);
});
test('无需品牌规则便可附加范围推导，前提仍逐字来自问题和资料',()=>{
 const c=attachRangeDerivation({...candidate,text:'310克超出170–290克范围。'},frame);
 assert.equal(c.kind,'advice');assert.equal(verifyCalculation(c,frame,context)?.excess,20);
 const falseRange={...candidate,calculation:{kind:'range' as const,actual:310,min:170,max:290,unit:'g',sourceId:'s',quote:'Weight 170 g. Another 290 g.',inputQuote:'310g',assertion:'outside' as const}};
 assert.throws(()=>verifyCalculation(falseRange,frame,{...context,evidence:[{...context.evidence[0],text:falseRange.calculation.quote}]}),/相邻范围/);
});
test('把厂家操作标成advice不能绕过原文校验',()=>{
 assert.match(precheck({...candidate,kind:'advice',sources:[]},frame,context).join(),/缺少原文/);
});
test('真实反例回归：维修经销商引文不能发布行业免责或失保推断',()=>{
 const c={...candidate,text:'自行拆修电池将导致保修责任免除。',sources:[{id:'s',quote:'Consult the nearest Sony dealer.'}]};
 const ctx={...context,evidence:[{...context.evidence[0],text:c.sources[0].quote}]};
 assert.equal(adjudicateCandidates(frame,[c],ctx,review)[0].published,false);
 assert.match(precheck(c,frame,ctx).join(),/政策原文/);
});
test('真实反例回归：QSG未提及Auracast不能得出不支持',()=>{
 const c={...candidate,text:'不支持Auracast；所有文档均未出现Auracast，只有MULTI-SPEAKER CONNECTION。',sources:[{id:'s',quote:'MULTI-SPEAKER CONNECTION'}]};
 assert.match(precheck(c,frame,{...context,evidence:[{...context.evidence[0],text:c.sources[0].quote}]}).join(),/明确否定/);
});
test('用户经历不能从产品官方功能推断',()=>{
 const f={...frame,parts:[{...frame.parts[0],kind:'relationship' as const}]};
 assert.match(precheck({...candidate,kind:'advice',text:'它曾帮你和朋友建立联系。'},f,context).join(),/产品说明不能/);
});
test('候选协议错误局部降级，不让正确兄弟项消失',()=>{
 const result=parseDraft({frame,candidates:[candidate,{id:'bad',partId:'p',kind:'unexpected'}],gaps:[]});
 assert.equal(result.candidates.length,1);assert.match(result.gaps[0].reason,/不完整/);
});
test('官方相同产品路径可关联规格和说明，不用相似型号猜测',()=>{
 assert.equal(officialProductPath('https://www.mi.com/sg/product/example-1/specs/'),officialProductPath('https://www.mi.com/ae-en/product/example-1/'));
 assert.notEqual(officialProductPath('https://www.mi.com/sg/product/example-1/'),officialProductPath('https://www.mi.com/sg/product/example-1-pro/'));
 assert.equal(officialProductPath('https://www.mi.com/support/'),undefined);
});

function fixture(){const f=validationFixture('.runtime/kernel-tests-'+crypto.randomUUID());migrateUnified(f.db);const id=f.add('合成测试耳机','耳机','Sony','WH-CH520');const i=f.read().items.find(i=>i.id===id)!;
 const d=makeKnowledgeDocument({url:'https://helpguide.sony.net/mdr/2958/v1/en/contents/TP1000776852.html',title:'WH-CH520 synthetic contract text',text:'WH-CH520. Press once briefly: Decrease the volume. Hold the button for 5 seconds.',links:[]},i,[]);
 storeOfficialDocument(f.db,'lin',i,d);return {...f,id,d};}
function providerFor(id:string,sourceId:string,extra?:()=>void){let calls=0;return {ready:true,model:'offline-contract',generate:async()=>{
 calls++;if(calls===2){extra?.();return {text:JSON.stringify({checks:[{id:'C1',verdict:'entailed',reason:'短按降低音量与原文直接对应',evidenceIds:[sourceId]}],omittedQuestions:[]}),model:'offline-contract',tokens:{input:10,output:10}};}
 return {text:JSON.stringify({frame:{goal:'完整回答',itemIds:[id],parts:[{id:'a',question:'短按减号',kind:'fact',risk:'ordinary',itemIds:[id],expectedResult:'了解音量变化'},{id:'b',question:'保修费用',kind:'fact',risk:'ordinary',itemIds:[id],expectedResult:'了解费用'}]},candidates:[{id:'c',partId:'a',itemIds:[id],kind:'fact',text:'短按减号降低音量。',sources:[{id:sourceId,quote:'Press once briefly: Decrease the volume.'}]}],gaps:[{partId:'b',reason:'资料没有维修收费政策'}]}),model:'offline-contract',tokens:{input:10,output:10}};
 }} as any;}
test('真实LangGraph入口：两问部分保留且不创建持久TaskSpec',async()=>{
 const f=fixture();process.env.WUJIAN_EXPERIMENTAL_KERNEL_V3='true';
 try{const r=await respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),itemId:f.id,mode:'service',question:'短按减号怎样，保修费用多少？',uiContext:{page:'item'},memoryPolicy:'off'},providerFor(f.id,f.d.chunks[0].id));
 assert.equal(r.modelCalls,2);assert.match(r.reply.answer,/降低音量/);assert.match(r.reply.answer,/缺适用资料/);assert.equal(r.reply.outcome,'needs_info');assert.equal(r.reply.task?.parts.length,2);assert.equal(r.reply.claimChecks?.[0].published,true);
 assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM foundation_tasks').get() as any).n,0);
 }finally{delete process.env.WUJIAN_EXPERIMENTAL_KERNEL_V3;f.db.close();}
});
test('模型在途遗忘：旧结果不可提交',async()=>{
 const f=fixture();process.env.WUJIAN_EXPERIMENTAL_KERNEL_V3='true';
 try{const m=saveMemory(f.db,f.read,'lin',{kind:'experience',text:'曾报告连接失败',itemId:f.id,allowCloud:true});
 await assert.rejects(()=>respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),itemId:f.id,mode:'service',question:'短按减号怎样？',uiContext:{page:'item'},memoryPolicy:'legacy'},providerFor(f.id,f.d.chunks[0].id,()=>forgetMemory(f.db,'lin',m.id))),/授权已改变|会话|上下文/);
 }finally{delete process.env.WUJIAN_EXPERIMENTAL_KERNEL_V3;f.db.close();}
});
test('权限与memory off：私人物品不在目录，云端报告不暗中加入',()=>{
 const f=fixture();try{const hidden=f.add('私有别人的物品','工具','Sony','OTHER');const s=f.read();s.items.find(i=>i.id===hidden)!.owner='dad';f.write(s);
 saveMemory(f.db,f.read,'lin',{kind:'relationship',text:'朋友赠送的秘密故事',itemId:f.id,allowCloud:true});
 const ctx=kernelContext(f.db,f.read(),'lin',{itemId:f.id,known:{memoryPolicy:'off'},messages:[],tried:[]} as any,'这件耳机怎样？');
 assert.ok(!ctx.catalogue.some(i=>i.id===hidden));assert.equal(ctx.experiences.length,0);assert.ok(!JSON.stringify(ctx).includes('秘密故事'));
 }finally{f.db.close();}
});
test('通用检索允许翻译查询找到英文陌生属性；不改写原文',()=>{
 const docs:any=[{id:'d',chunks:Array.from({length:40},(_,n)=>({id:'c'+n,documentId:'d',start:n*1000,text:n===35?'Cobalt sample: rotating ring unlocks the compartment.':'Overview technical text '+n,title:'Guide'}))}];
 const found=retrieveTaskPassages(docs,['旋转怎么开启','rotating ring compartment'],[],200);
 assert.ok(found.some(c=>c.id==='c35'));assert.match(found.find(c=>c.id==='c35')!.text,/rotating ring/);
});
test('隐私失效后的旧Task目标不能绕resolveTaskContext复活',()=>{
 const f=fixture();try{
 const t=createTask(f.db,f.read,'lin',{requestId:crypto.randomUUID(),goal:'只属于我的秘密赠送者小星',intent:'guide',itemInstanceIds:[f.id]});
 const m=saveMemory(f.db,f.read,'lin',{kind:'relationship',text:'秘密赠送者小星',itemId:f.id,allowCloud:true});forgetMemory(f.db,'lin',m.id);
 const ctx=kernelContext(f.db,f.read(),'lin',{itemId:f.id,known:{memoryPolicy:'off',foundationTaskId:t.taskId},messages:[],tried:[]} as any,'怎样操作？');
 assert.ok(!JSON.stringify(ctx).includes('秘密赠送者小星'));assert.match(ctx.currentTask!.goal,/语境已经变更/);
 }finally{f.db.close();}
});
test('显式撤权优先于遗留shared字段，不能进目录和模型',()=>{
 const f=fixture();try{
 const s=f.read(),i=s.items.find(i=>i.id===f.id)!;i.owner='dad';i.shared=true;i.sharedWith=['lin'];f.write(s);
 mirrorItemGrant(f.db,f.read(),'dad','lin',f.id,false);
 const ctx=kernelContext(f.db,f.read(),'lin',{itemId:f.id,known:{memoryPolicy:'off'},messages:[],tried:[]} as any,'怎样操作？');
 assert.ok(!ctx.catalogue.some(i=>i.id===f.id));assert.equal(ctx.items.length,0);assert.ok(ctx.evidence.every(e=>e.id==='user:current-turn'));
 }finally{f.db.close();}
});
test('本轮明确陈述可用于本轮关系理解，不自动变成长期记忆或厂家证据',()=>{
 const f=fixture();try{
 const q='这副耳机是小星送我的，帮我安排一次使用。';
 const ctx=kernelContext(f.db,f.read(),'lin',{itemId:f.id,known:{memoryPolicy:'off'},messages:[],tried:[]} as any,q);
 assert.equal(ctx.evidence.find(e=>e.id==='user:current-turn')?.basis,'user_report');
 assert.equal(ctx.evidence.find(e=>e.id==='user:current-turn')?.text,q);
 assert.equal(ctx.experiences.length,0);
 }finally{f.db.close();}
});
