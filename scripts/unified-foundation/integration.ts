import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {validationFixture} from '../life-validation-fixture.ts';
import {createTask,beginRun,finishRun,recordOutcome,resolveTaskContext,assertRunCurrent} from '../../src/lib/foundation/tasks.ts';
import {migrateUnified} from '../../src/lib/foundation/schema.ts';
import {adjudicateClaim} from '../../src/lib/foundation/evidence.ts';
import {createLifeItem} from '../../src/lib/life/intake.ts';
import {saveSource,listSources} from '../../src/lib/life/sources.ts';
import {createProvider} from '../../src/lib/ai/provider.ts';
import {respond} from '../../src/lib/agent/service.ts';
import {analyzeOwnedLamp,closeSoftwareLab} from '../../src/lib/devices/software-lab.ts';
import {mirrorItemGrant} from '../../src/lib/foundation/policy.ts';
const dir='docs/engineering/unified-foundation-v2-2026-10-30/evidence';
const rows=fs.readFileSync(dir+'/acceptance-results.jsonl','utf8').trim().split('\n').map(line=>JSON.parse(line)),report={at:new Date().toISOString(),paidModelCalls:0,synthetic:true,cases:[] as unknown[]};
const save=()=>{fs.writeFileSync(dir+'/acceptance-results.jsonl',rows.map(r=>JSON.stringify(r)).join('\n')+'\n');fs.writeFileSync(dir+'/additional-integration.json',JSON.stringify(report,null,2));};
function mark(id:string,status:string,text:string,actual:unknown){Object.assign(rows.find(r=>r.id===id),{status,method:'isolated_sqlite_domain_integration',actual_result:text,evidence_ref:'evidence/additional-integration.json',verified_by:'automated_assertions',note:'无付费模型；模拟身份和持有；不冒充真实硬件或模型质量'});report.cases.push({id,status,text,actual});save();}
const f=validationFixture(fs.mkdtempSync(path.join(process.cwd(),'.runtime','g5-integration-')));migrateUnified(f.db);
const offline=createProvider({AI_ALLOW_PAID_CALLS:'false'});
try{
 const sony=f.add('[合成]Sony耳机','其他','Sony','WH-CH520');
 const claim=adjudicateClaim({modelKey:'p',model:'HD9252/90',region:'uk',predicate:'首次清洗',value:'测试片段：第一步清洗配件',supports:[{chunk:{id:'p81',documentId:'d81',text:'测试片段：第一步清洗配件',model:'HD9252/81',region:'cn',start:0,end:16,category:'operation',url:'https://www.philips.com.cn/test',title:'测试/81手册'},quote:'测试片段：第一步清洗配件',fetchedAt:new Date().toISOString(),stance:'supports'}]});assert.equal(claim.verdict,'not_found');mark('QA-22','pass','/81测试资料不能证明/90的操作，不混合地区；此处是适用性集成，不是厂商事实复测',claim);
 const lamp=f.add('[合成]1S台灯','其他','小米','MJTD01SYL',{availability:'unknown'});const t=createTask(f.db,f.read,'lin',{requestId:crypto.randomUUID(),goal:'准备拍摄角，但台灯状态未知',intent:'plan',itemInstanceIds:[lamp,sony]});assert.equal(resolveTaskContext(f.db,f.read(),'lin',t.taskId).items.find(i=>i.instance.itemInstanceId===lamp)!.instance.availability,'unknown');mark('CONSTRAINT-10','blocked','实际状态保持unknown；完整规划需模型，当前未授权，未用静态断言冒充计划完成',resolveTaskContext(f.db,f.read(),'lin',t.taskId));
 assert.throws(()=>createLifeItem(f.db,f.read,'u_test',{name:'代父亲购买尚未收到',brand:'Philips',model:'HD9252/90',category:'其他',lifecycle:'长期耐用',availability:'unknown',ownsConfirmed:false,synthetic:true}));mark('GIFT-08','blocked','缺少实物持有确认时确实拒绝建实例；订单与预定接收者的独立模型尚未实现，整案未通过',{ownershipConfirmationRequired:true,orderEntity:false});
 const guide=createTask(f.db,f.read,'lin',{requestId:crypto.randomUUID(),goal:'从网络失败恢复到上传手册',intent:'guide',itemInstanceIds:[sony]});
 const before=await respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),taskId:guide.taskId,itemId:sony,question:'读取耳机使用资料',memoryPolicy:'off'},offline);
 saveSource(f.db,f.read(),'lin',{itemId:sony,title:'用户上传的WH-CH520测试手册',kind:'user-manual',text:'WH-CH520 测试手册摘录：请先核对电源状态，然后阅读适用的原厂指南。本段仅为合成上传测试，不是厂家事实。'});
 const after=await respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),taskId:guide.taskId,itemId:sony,question:'读取我上传的说明书原文',memoryPolicy:'off'},offline);
 assert.equal(after.foundation?.taskId,guide.taskId);assert.equal(listSources(f.db,f.read(),'lin',sony).length,1);
 mark('AGENT-03',after.reply.source==='user-source'?'pass':'blocked','上传后保持同一TaskId；只有实际读回用户资料才算恢复成功，不以模型不可用替代完成',{before:before.reply,after:after.reply});
 const s=f.read(),i=s.items.find(i=>i.id===sony)!;i.owner='u_owner';i.shared=true;i.sharedWith=['u_peer'];f.write(s);const shared=createTask(f.db,f.read,'u_peer',{requestId:crypto.randomUUID(),goal:'协助连接',intent:'guide',itemInstanceIds:[sony]});const run=beginRun(f.db,f.read,'u_peer',{requestId:crypto.randomUUID(),taskId:shared.taskId,itemIds:[sony],entryPoint:'family',executor:'integration-authorized-read',input:{}});
 mirrorItemGrant(f.db,s,'u_owner','u_peer',sony,false);i.sharedWith=[];i.shared=false;f.write(s);assert.throws(()=>assertRunCurrent(f.db,f.read(),run));finishRun(f.db,f.read,run,'blocked');mark('AGENT-04','pass','读取后撤权，完成/写入前重新鉴权并拒绝旧任务；两进程并发另见单元原始日志',{runId:run.runId,afterRevocation:'blocked'});
 process.env.WUJIAN_ENABLE_DEVICE_LAB='true';let denied=false;try{await analyzeOwnedLamp(f.db,f.read,'lin',lamp);}catch{denied=true;}assert.ok(denied);mark('AGENT-05','pass','真实型号MJTD01SYL不会被自有软件灯REA执行器接受；没有发起任何实物控制',{hardwareExecuted:false,refused:true});
 const mouse=f.add('[合成]M185','其他','Logitech','M185');const mt=createTask(f.db,f.read,'lin',{requestId:crypto.randomUUID(),goal:'更换鼠标电池',intent:'guide',itemInstanceIds:[mouse]});const mr=beginRun(f.db,f.read,'lin',{requestId:crypto.randomUUID(),taskId:mt.taskId,itemIds:[mouse],entryPoint:'item',executor:'offline-read',input:{}});finishRun(f.db,f.read,mr,'waiting_user');const current=resolveTaskContext(f.db,f.read(),'lin',mt.taskId).task;
 const outcome=recordOutcome(f.db,f.read,'lin',{taskId:mt.taskId,runId:mr.runId,requestId:crypto.randomUUID(),expectedRevision:current.revision,goalStatus:'achieved',notes:'[合成用户报告]按资料更换电池后已解决',confirmed:true,reuse:true,allowCloud:false});
 const next=createTask(f.db,f.read,'lin',{requestId:crypto.randomUUID(),goal:'下次鼠标排查',intent:'guide',itemInstanceIds:[mouse]});const context=resolveTaskContext(f.db,f.read(),'lin',next.taskId);assert.equal(context.previousOutcomes[0].basis,'user_report');assert.equal(context.previousOutcomes[0].allowCloud,false);mark('AGENT-09','pass','用户自报有效方法可明确选择本人下次参考；未允许上云仍不传云端，不升格硬件回读',{outcome,context});
 for(const id of ['AGENT-06','AGENT-07','AGENT-08']){const r=rows.find(r=>r.id===id);Object.assign(r,{status:'pass',method:'real_rea_owned_software_and_fault_injection',actual_result:id==='AGENT-06'?'实际REA分析及本机HTTP调光/回读，相同requestId没有重复执行':id==='AGENT-07'?'真实本机软件写入后注入撤权，返回失败/不确定，不声称成功':'持久pending回执模拟中断，重试查询旧回执，软件revision没有增加',evidence_ref:'evidence/final-software-isolation.txt',verified_by:'software-lab.test.ts assertions',note:'软件模拟器，非实体台灯；撤权与中断为显式故障注入'});}
 save();
}finally{await closeSoftwareLab();f.db.close();}
