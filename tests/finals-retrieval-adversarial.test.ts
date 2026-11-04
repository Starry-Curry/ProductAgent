import test from 'node:test';
import assert from 'node:assert/strict';
import {retrieveTaskPassages} from '../src/lib/agent/kernel/retrieval.ts';
import type {AcquiredDocument,KnowledgeChunk} from '../src/lib/life/acquisition.ts';

const doc=(id:string,texts:string[])=>({id,chunks:texts.map((text,n)=>({id:id+':'+n,documentId:id,title:'Synthetic guide',text,start:n*200,end:n*200+text.length,url:'https://example.org/'+id,model:'SYNTHETIC'}))} as AcquiredDocument);
test('对抗检索：多个无关文档的保底片段不能挤掉预算内真正相关的后续手册',()=>{
 const noise=Array.from({length:8},(_,n)=>doc('noise'+n,['Unrelated content. '.repeat(4)]));
 const relevant=doc('manual',['Hold the pairing button for five seconds.']);
 const result=retrieveTaskPassages([...noise,relevant],['pairing button'],[],180);
 assert.ok(result.some(c=>c.documentId==='manual'),'相关操作不应因资料顺序靠后而消失');
 assert.ok(result.reduce((n,c)=>n+c.text.length,0)<=180);
});
test('对抗检索：模型提出的查询只是选择线索，不可改写来源正文或引用身份',()=>{
 const source=doc('manual',['PAIRING button: hold for five seconds.','Charging: do not use when wet.']);
 const before=JSON.stringify(source),result=retrieveTaskPassages([source],['pairing charging'],[],200);
 assert.equal(JSON.stringify(source),before);
 for(const c of result)assert.ok(source.chunks.some(original=>original.id===c.id&&original.text===c.text&&original.start===c.start));
 assert.ok(result.some(c=>c.text.includes('wet')));
});
test('对抗检索：没有词法匹配仍保留有限原文，不把无匹配证明为不支持',()=>{
 const docs=[doc('a',['A hollow structure.']),doc('b',['A removable lid.'])];
 const result=retrieveTaskPassages(docs,['陌生功能'],[],100);
 assert.equal(result.length,2);assert.ok(result.every(c=>!c.text.includes('不支持')));
});
