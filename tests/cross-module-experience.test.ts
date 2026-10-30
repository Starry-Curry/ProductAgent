import test from "node:test";
import assert from "node:assert/strict";
import { validationFixture } from "../scripts/life-validation-fixture.ts";
import { migrateUnified } from "../src/lib/foundation/schema.ts";
import { createTask,beginRun,finishRun,getTask,recordOutcome,resolveTaskContext,amendOutcome } from "../src/lib/foundation/tasks.ts";
import { discoverInTask } from "../src/lib/foundation/creative.ts";
import { feedbackIdea } from "../src/lib/life/ideas.ts";
import { makeKnowledgeDocument,storeOfficialDocument } from "../src/lib/life/acquisition.ts";
import { respond } from "../src/lib/agent/service.ts";
import { saveFragment,listFragments } from "../src/lib/life/stories.ts";
import { createLifeGift } from "../src/lib/life/gifts.ts";
import { saveMemory,listMemories } from "../src/lib/memory/store.ts";
import { mutate,visible } from "../src/lib/domain.ts";

function setup(){const f=validationFixture(".runtime/cross-module-"+crypto.randomUUID());migrateUnified(f.db);return f;}
function report(f:ReturnType<typeof setup>,taskId:string,runId:string,notes:string,allowCloud:boolean){
 return recordOutcome(f.db,f.read,"lin",{taskId,runId,requestId:crypto.randomUUID(),expectedRevision:getTask(f.db,f.read(),"lin",taskId).revision,goalStatus:"achieved",notes,confirmed:true,reuse:true,allowCloud});
}
test("旅程A｜耳机操作→用户经验→跨会话实际送到执行器；替身验证而非模型质量",async()=>{
 const f=setup();try{
   const id=f.add("[合成持有]陌生耳机","电子设备","Sony","WH-CH520"), item=f.read().items.find(i=>i.id===id)!;
   const quote="press and hold the (Bluetooth) button for about 5 seconds or more";
   storeOfficialDocument(f.db,"lin",item,makeKnowledgeDocument({url:"https://helpguide.sony.net/mdr/2958/v1/en/contents/TP1000776852.html",title:"WH-CH520 Pairing",text:"WH-CH520. Offline source extraction fixture. To pair a second device, "+quote+".",links:[]},item,[],"unspecified"));
   let received:any[]=[];
   const provider:any={ready:true,model:"offline-contract-only",generate:async(_system:string,input:any)=>{received.push(input);return {text:JSON.stringify({kind:"grounded",answer:"配对说明",steps:[{text:"按住蓝牙按钮约5秒，进入配对模式。",sourceIds:[input.officialDocuments[0].id],sourceQuote:quote}],questions:[],gaps:[]}),model:"offline-contract-only",tokens:null};}};
   const task=createTask(f.db,f.read,"lin",{requestId:crypto.randomUUID(),goal:"连接第二部手机",intent:"guide",itemInstanceIds:[id]});
   const a=await respond(f.db,f.read,"lin",{requestId:crypto.randomUUID(),taskId:task.taskId,itemId:id,question:"如何配对第二部手机？"},provider);
   assert.equal(a.reply.source,"model-with-evidence");assert.equal(a.modelCalls,1);
   const o=report(f,task.taskId,a.foundation!.runId,"[合成用户报告]移近手机后可以连接；不证明每次都适用",true);
   const b=await respond(f.db,f.read,"lin",{requestId:crypto.randomUUID(),itemId:id,question:"如何配对另一部手机？"},provider);
   assert.notEqual(a.session.id,b.session.id);assert.equal(received.at(-1).previousUserReports[0].outcomeId,o.outcomeId);
   amendOutcome(f.db,f.read,"lin",{outcomeId:o.outcomeId,expectedRevision:1,operation:"revoke_reuse",requestId:crypto.randomUUID(),confirmed:true});
   await respond(f.db,f.read,"lin",{requestId:crypto.randomUUID(),itemId:id,question:"如何配对另一部手机？"},provider);
   assert.equal(received.at(-1).previousUserReports.length,0);
 }finally{f.db.close();}
});
test("旅程B｜开放创造沿同一任务记录→用户反馈→后续探索复用；物理可行性未实测",async()=>{
 const f=setup();try{
   const a=f.add("[合成]夹子","生活物品","","",{attributes:{material:"木",capabilities:["夹持"]}}),b=f.add("[合成]网袋","生活物品","","",{attributes:{material:"织物",capabilities:["透气"]}});
   const task=createTask(f.db,f.read,"lin",{requestId:crypto.randomUUID(),goal:"让旅行物品更好晾放，不买东西",intent:"explore",itemInstanceIds:[a,b]});
   const seen:any[]=[];const provider:any={ready:true,model:"offline-contract-only",generate:async(_s:string,input:any)=>{seen.push(input);return {text:"## 旅行小件晾放袋\n将网袋作为小件集中晾放容器，夹子只固定已有袋口。仍须核对挂点、夹持力和织物状态，不承诺承重。",model:"offline-contract-only",tokens:null};}};
   const result=await discoverInTask(f.db,f.read,"lin",{goal:task.goal,itemIds:[a,b],model:true,publicEvidence:false},provider,task.taskId);
   assert.equal(result.foundation!.taskId,task.taskId);assert.equal(result.ideas[0].tested,false);
   feedbackIdea(f.db,f.read(),"lin",{id:result.ideas[0].id,saved:true,outcome:"用户报告有效",note:"[合成]只放了轻量小件"});
   report(f,task.taskId,result.foundation!.runId,"[合成用户报告]轻量小件集中晾放有效；挂点仍需每次核对",true);
   await discoverInTask(f.db,f.read,"lin",{goal:"继续找旅行小件新用途，不购买",itemIds:[a,b],model:true,publicEvidence:false},provider);
   assert.ok(seen.at(-1).context.previousUserReports[0].notes.includes("挂点"));
 }finally{f.db.close();}
});
test("旅程D｜同任务保存故事→选择性赠礼→独立实例，双方后续私人经历隔离",()=>{
 const f=setup();try{
   const id=f.add("[合成]朋友赠画","其他","","原创画作");
   const state=f.read();state.items.find(i=>i.id===id)!.owner="u_giver";f.write(state);
   const task=createTask(f.db,f.read,"u_giver",{requestId:crypto.randomUUID(),goal:"让一段物品经历延续",intent:"gift",itemInstanceIds:[id]});
   const selected=saveFragment(f.db,f.read,"u_giver",{text:"[合成]小周送来的画，想把它的故事继续传递",itemIds:[id],allowRecall:false,allowCloud:false},task.taskId);
   saveFragment(f.db,f.read,"u_giver",{text:"[合成私人]不随赠礼分享的经历",itemIds:[id],allowRecall:false,allowCloud:false});
   saveMemory(f.db,f.read,"u_giver",{itemId:id,kind:"relationship",text:"[合成]只属于原主的关系记忆",allowCloud:false});
   const gift=createLifeGift(f.db,f.read,"u_giver",{itemId:id,message:"愿你喜欢",fragmentIds:[selected.id]},task.taskId);
   const next=mutate(f.read(),"u_receiver","claim",{token:gift.token,received:true});f.write(next);
   const item=next.items.at(-1)!;assert.notEqual(item.id,id);assert.equal(item.owner,"u_receiver");
   assert.ok(visible(next,"u_receiver").memories.some(m=>m.text===selected.text));
   assert.ok(!JSON.stringify(visible(next,"u_receiver")).includes("不随赠礼分享"));
   assert.equal(listMemories(f.db,next,"u_receiver").length,0);
   saveFragment(f.db,f.read,"u_receiver",{text:"[合成]收礼人新的私事",itemIds:[item.id],allowRecall:false,allowCloud:false});
   assert.ok(!JSON.stringify(listFragments(f.db,f.read(),"u_giver")).includes("收礼人新的私事"));
 }finally{f.db.close();}
});
