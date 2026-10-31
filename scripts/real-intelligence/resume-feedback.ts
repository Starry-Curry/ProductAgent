import fs from 'node:fs';
import { gateway } from './gateway.mjs';
import { validationFixture } from '../life-validation-fixture.ts';
import { createProvider } from '../../src/lib/ai/provider.ts';
import { discoverInTask } from '../../src/lib/foundation/creative.ts';
import { feedbackIdea } from '../../src/lib/life/ideas.ts';
import { recordOutcome,getTask } from '../../src/lib/foundation/tasks.ts';
if(!process.argv.includes('--authorized-150-cny50'))throw Error('authorization_required');
const dir='docs/engineering/real-intelligence-2026-10-31/evidence',file=dir+'/creative-feedback-v1.json';
if(fs.existsSync(file))throw Error('evidence_exists');
const previous=JSON.parse(fs.readFileSync(dir+'/journeys-v2.json','utf8')).rows.find((r:any)=>r.id==='creative-first').result;
const f=validationFixture('.runtime/journeys-v2');const idea=previous.ideas[0];
feedbackIdea(f.db,f.read(),'lin',{id:idea.id,saved:true,outcome:'不感兴趣',note:'[合成反馈]不接受隔着透明盒拍摄，反光影响效果。希望盒子换一种作用。'});
const o=recordOutcome(f.db,f.read,'lin',{taskId:previous.foundation.taskId,runId:previous.foundation.runId,requestId:crypto.randomUUID(),expectedRevision:getTask(f.db,f.read(),'lin',previous.foundation.taskId).revision,goalStatus:'not_achieved',notes:'[合成用户报告]不接受隔着透明盒拍摄，反光明显；不是现实拍摄验证。',confirmed:true,reuse:true,allowCloud:true});
const gate=await gateway('D:/ProductAgent-LifeContext/.env.local');let label='creative-feedback-v1/wujian',input:any;
const p=createProvider({AI_BASE_URL:'https://fixture.invalid/v1',AI_API_KEY:'fixture-only',AI_MODEL:gate.model,AI_ALLOW_PAID_CALLS:'true',AI_ENABLE_THINKING:'false',AI_REQUEST_TIMEOUT_MS:'90000'},(_u,init)=>{input=JSON.parse(String(init?.body));return fetch(gate.url+'/v1/chat/completions',{...init,headers:{...init?.headers,'x-wujian-evaluation':label}});});
const rows:any[]=[];const save=()=>fs.writeFileSync(file,JSON.stringify({roundId:'real-intelligence-20261031-r1',synthetic:true,physicalTests:0,feedback:idea.id,outcome:o,rows},null,2));
try{let start=performance.now();try{const result=await discoverInTask(f.db,f.read,'lin',{goal:'根据我之前否定的结果换一个摄影新用途，盒子不要作为镜头前的滤镜。不买、不剪、不粘，不增添器材；结合我的兴趣。',itemIds:idea.itemIds,model:true,publicEvidence:false,previousIdeaIds:[idea.id],feedbackIdeaIds:[idea.id]},p);rows.push({arm:'wujian',result,elapsedMs:Math.round(performance.now()-start)});}catch(e){rows.push({arm:'wujian',error:(e as Error).message});}save();
 if(input){label='creative-feedback-v1/direct';const same=JSON.parse(input.messages.find((m:any)=>m.role==='user').content);start=performance.now();try{const result=await p.generate('根据相同物品、官方资料、获准偏好和上次反馈探索不同的新用途。不编造物理能力或额外资源，未确认的条件明说。',same,{temperature:0.2,json:false,maxTokens:4000,timeoutMs:90000});rows.push({arm:'direct',result,elapsedMs:Math.round(performance.now()-start)});}catch(e){rows.push({arm:'direct',error:(e as Error).message});}save();}
 console.log(JSON.stringify(rows.map(r=>({arm:r.arm,error:r.error,ms:r.elapsedMs}))));
}finally{save();f.db.close();await gate.close();}
