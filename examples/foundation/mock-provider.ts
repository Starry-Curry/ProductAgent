import type {Provider} from '../../src/lib/foundation/services.ts';
/** Explicit offline protocol substitute. No network or quality claim. */
export function foundationMock():Provider{
 let calls=0;
 return {ready:true,model:'offline-team-example',structuredOutput:'json_schema',generate:async()=>{throw Error('no_extra_extractor');},converse:async messages=>{
  const payload=JSON.parse(messages.find(m=>m.role==='user')!.content!);
  if(calls++===0)return {model:'offline-team-example',text:'',tokens:null,finishReason:'tool_calls',toolCalls:[{id:crypto.randomUUID(),type:'function',function:{name:'get_item_context',arguments:JSON.stringify({itemIds:[],query:payload.question})}}]};
  return {model:'offline-team-example',text:'',tokens:null,finishReason:'tool_calls',toolCalls:[{id:crypto.randomUUID(),type:'function',function:{name:'complete_answer',arguments:JSON.stringify({message:'[离线协议示例，不是千问结果]已按获准 Context 读取 '+payload.items.length+' 件候选；实际条件仍须核对。',guidance:null})}}]};
 }};
}
