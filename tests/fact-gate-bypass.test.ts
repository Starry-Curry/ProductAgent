import test from 'node:test';
import assert from 'node:assert/strict';
import { validationFixture } from '../scripts/life-validation-fixture.ts';
import { storeOfficialDocument,makeKnowledgeDocument } from '../src/lib/life/acquisition.ts';
import { respond } from '../src/lib/agent/service.ts';
test('事实实验关闭时，物品帮助不能借general标签发布未核实型号结论',async()=>{
 const old=process.env.WUJIAN_EXPERIMENTAL_FACT_QA;process.env.WUJIAN_EXPERIMENTAL_FACT_QA='false';
 const f=validationFixture('.runtime/gate-bypass-'+crypto.randomUUID());try{
 const id=f.add('[合成持有]耳机','电子设备','Sony','WH-CH520');const item=f.read().items.find(i=>i.id===id)!;
 storeOfficialDocument(f.db,'lin',item,makeKnowledgeDocument({url:'https://helpguide.sony.net/mdr/2958/v1/en/contents/TP1000776852.html',title:'WH-CH520 Guide',text:'WH-CH520. Press the Bluetooth button to pair another device. This document has no ANC information.',links:[]},item,[]));
 const packet=JSON.stringify({kind:'general',answer:'索尼官方已证实WH-CH520不支持主动降噪。',factIds:[],procedureId:null,questions:[]});
 const p:any={ready:true,model:'offline-contract',generate:async()=>({text:packet,model:'offline-contract',tokens:null}),complete:async()=>({text:packet,model:'offline-contract',tokens:null,toolCalls:[],finishReason:'stop'})};
 const r=await respond(f.db,f.read,'lin',{requestId:crypto.randomUUID(),itemId:id,question:'这份指南没提ANC，就证明不支持吗？',mode:'service',memoryPolicy:'off',uiContext:{page:'item'}},p);
 assert.ok(!r.reply.answer.includes('官方已证实'));assert.equal(r.reply.outcome,'needs_info');
 }finally{f.db.close();if(old===undefined)delete process.env.WUJIAN_EXPERIMENTAL_FACT_QA;else process.env.WUJIAN_EXPERIMENTAL_FACT_QA=old;}
});
