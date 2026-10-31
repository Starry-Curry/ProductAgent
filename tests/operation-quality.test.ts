import test from 'node:test';
import assert from 'node:assert/strict';
import { multilingualAnchors } from '../src/lib/life/retrieval-topics.ts';
import { groundedReply,quoteInSource } from '../src/lib/skills/document-help.ts';
import { answerKnownItem } from '../src/lib/agent/grounded-answer.ts';
const chunk:any={id:'x',documentId:'d',start:0,end:100,url:'https://example.invalid/manual',title:'Manual',model:'test',region:'unspecified',category:'operation',text:'Press and turn. Adjusts color temperature.'};
test('HTML括号内换行是排版差异，数字/否定变化仍拒绝',()=>{
 const s='Hold the (\nBluetooth\n) button for 5 seconds. Select [\nWH-CH520\n]. Do not immerse.';
 assert.equal(quoteInSource(s,'Hold the (Bluetooth) button for 5 seconds.'),true);
 assert.equal(quoteInSource(s,'Select [WH-CH520].'),true);
 assert.equal(quoteInSource(s,'Hold the (Bluetooth) button for 7 seconds.'),false);
 assert.equal(quoteInSource(s,'Do immerse.'),false);
});
test('跨语检索优先具体操作章节，而非有相同词的长手册目录',()=>{
 const noise=[0,1].map(n=>({...chunk,id:'n'+n,title:'print.pdf',text:'Contents: Pairing. Connect. Bluetooth. Charging. More topics.'}));
 const actual={...chunk,id:'procedure',title:'Pairing and connecting to a Bluetooth device',text:'Hold the Bluetooth button for 5 seconds.'};
 assert.equal(multilingualAnchors('如何配对新设备？',[...noise,actual])[0].id,'procedure');
});
test('英文Press and turn支持中文按住旋转，不应只认hold丢失色温步骤',()=>{
 const r=groundedReply({kind:'grounded',answer:'调色温',steps:[{text:'按住旋钮并旋转，调节色温。',sourceIds:['x'],sourceQuote:chunk.text}]},[chunk],{tried:[]});
 assert.ok(r.steps.some(s=>s.text.includes('色温')));
});
test('部分步骤被拒绝时不能标为完整已回答',()=>{
 const r=groundedReply({kind:'grounded',answer:'操作',steps:[{text:'旋转旋钮调节色温。',sourceIds:['x'],sourceQuote:chunk.text},{text:'按住10秒。',sourceIds:['x'],sourceQuote:chunk.text}]},[chunk],{tried:[]});
 assert.equal(r.outcome,'needs_info');
});
test('仅回显本轮仍获准且被模型选中的用户经验，不能回显伪造或已遗忘ID',async()=>{
 const context:any={item:{id:'i',model:'test'},externalKnowledge:[chunk],cloudMemories:[],cloudFragments:[],cloudPreferences:[],cloudExperiences:[{outcomeId:'approved',notes:'关闭旧手机蓝牙后成功',basis:'user_report'}],persona:{enabled:false}};
 const session:any={known:{},messages:[],tried:[]};
 const provider:any={model:'offline-contract',generate:async()=>({text:JSON.stringify({kind:'grounded',answer:'操作',steps:[{text:'旋转旋钮调节色温。',sourceIds:['x'],sourceQuote:chunk.text}],experienceIds:['approved','forged'],questions:[],gaps:[]}),model:'offline-contract',tokens:null})};
 let r=await answerKnownItem(context,session,'如何操作？',provider,true);assert.match(r.reply.answer,/关闭旧手机蓝牙/);assert.match(r.reply.answer,/用户报告/);assert.ok(!r.reply.answer.includes('forged'));
 context.cloudExperiences=[];r=await answerKnownItem(context,session,'如何操作？',provider,true);assert.ok(!r.reply.answer.includes('关闭旧手机蓝牙'));
 session.known.memoryPolicy='off';context.cloudExperiences=[{outcomeId:'approved',notes:'关闭旧手机蓝牙后成功'}];r=await answerKnownItem(context,session,'如何操作？',provider,true);assert.ok(!r.reply.answer.includes('关闭旧手机蓝牙'));
});
