import test from 'node:test';import assert from 'node:assert/strict';
import {validationFixture} from '../scripts/life-validation-fixture.ts';import {respond} from '../src/lib/agent/service.ts';

test('自有合成软件目标不是未核实的消费品；不得被迫检索虚构品牌官网',async t=>{
 const f=validationFixture('.runtime/finals-software-target-'+crypto.randomUUID());t.after(()=>f.db.close());
 const flags={WUJIAN_AGENT_RUNTIME:'native',WUJIAN_ENABLE_DEVICE_LAB:'true',WUJIAN_ALLOW_PUBLIC_FETCH:'false'};const old=Object.fromEntries(Object.keys(flags).map(k=>[k,process.env[k]]));Object.assign(process.env,flags);t.after(()=>{for(const [k,v]of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;});
 const id=f.add('[合成]未分析的软件灯','电子','Wujian','WUJIAN-SOFTWARE-LAMP-1');const state=f.read();state.items.find(i=>i.id===id)!.synthetic=true;f.write(state);
 const r=await respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),itemId:id,question:'先告诉我这个自有软件实验可以怎样开始，不操作任何硬件。',mode:'auto',memoryPolicy:'off'},{ready:true,structuredOutput:'json_schema',model:'offline-routing-protocol',generate:async()=>{throw Error('no_network');},converse:async(messages,_tools,options)=>{
  assert.notDeepEqual(options?.toolChoice,{type:'function',function:{name:'search_product_knowledge'}});
  const packet=JSON.parse(messages.find(m=>m.role==='user')!.content!);assert.ok(packet.localSoftwareTargets.some((s:any)=>s.itemId===id&&s.basis==='fixed_owned_software_fixture_not_physical_product'));
  return {model:'offline-routing-protocol',text:'',tokens:null,finishReason:'tool_calls',toolCalls:[{id:'explain',type:'function',function:{name:'complete_answer',arguments:JSON.stringify({message:'这是本机自有软件实验。可以先分析候选；尚未分析，不能声称已有控制能力。',guidance:null})}}]};
 }});
 assert.equal(r.reply.outcome,'answered');assert.equal(r.modelCalls,1);
});
