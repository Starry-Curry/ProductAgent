import test from 'node:test';
import assert from 'node:assert/strict';
import { answerKnownItem } from '../src/lib/agent/grounded-answer.ts';
const context:any={item:{id:'i',name:'合成耳机',model:'WH-CH520',region:'unspecified'},factDocuments:[],externalKnowledge:[],cloudMemories:[],cloudExperiences:[],cloudFragments:[],cloudPreferences:[],persona:{enabled:false}};
const session:any={known:{},messages:[],tried:[]};
test('真实模型返回null表示未知：不应协议报错后抛出无关说明书摘录',async()=>{
 const provider:any={model:'offline-contract',generate:async()=>({text:JSON.stringify({claims:[{predicate:'repair_cost',value:null},{predicate:'warranty_void_if_self_repair',value:null},{predicate:'anc_supported',value:null}]}),model:'offline-contract',tokens:null})};
 const result=await answerKnownItem(context,session,'维修多少钱，拆机会失保吗？',provider,false);
 assert.equal(result.reply.outcome,'needs_info');assert.match(result.reply.answer,/维修费用/);assert.match(result.reply.answer,/保修/);assert.match(result.reply.answer,/证据不足/);assert.ok(!result.reply.answer.includes('原始摘录'));
});
