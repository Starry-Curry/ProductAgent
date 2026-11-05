import test from 'node:test';import assert from 'node:assert/strict';import {validationFixture} from '../scripts/life-validation-fixture.ts';import {makeKnowledgeDocument} from '../src/lib/life/acquisition.ts';import {scopedProductKnowledge} from '../src/lib/context/evidence-scope.ts';
test('共同的厂家商品分类路径不能把另一型号的规格认证为当前型号；网址仅作导航线索',t=>{
 const f=validationFixture('.runtime/finals-category-scope-'+crypto.randomUUID());t.after(()=>f.db.close());const id=f.add('[合成]分类路径设备','其他','Sony','SYNTH-CAMERA-A'),item=f.read().items.find(i=>i.id===id)!;const current=makeKnowledgeDocument({url:'https://www.sony.com/product/cameras/synth-camera-a/',title:item.model,text:item.model+' Synthetic exact-model page, not actual product facts.',links:[]},item,[]),other=makeKnowledgeDocument({url:'https://www.sony.com/product/cameras/synth-camera-b/specs/',title:'SYNTH-CAMERA-B specifications',text:'SYNTH-CAMERA-B. FALSE-OTHER-SKU-SENTINEL. Synthetic wrong-model page.',links:[]},item,[]);
 assert.deepEqual(scopedProductKnowledge(item,[current,other]).map(r=>r.document.id),[current.id]);
});
test('通用相同路径和查询参数也不能替代型号核对；确有厂家原文的型号仍可读取',t=>{
 const f=validationFixture('.runtime/finals-query-scope-'+crypto.randomUUID());t.after(()=>f.db.close());const id=f.add('[合成]查询参数设备','其他','Sony','SYNTH-QUERY-A'),item=f.read().items.find(i=>i.id===id)!;const current=makeKnowledgeDocument({url:'https://www.sony.com/product/devices/detail?id=a',title:item.model,text:item.model+' Synthetic correct record.',links:[]},item,[]),wrong=makeKnowledgeDocument({url:'https://www.sony.com/product/devices/detail?id=b',title:'SYNTH-QUERY-B',text:'SYNTH-QUERY-B. NOT-THE-SAME-MODEL.',links:[]},item,[]);assert.equal(scopedProductKnowledge(item,[current,wrong]).length,1);assert.equal(scopedProductKnowledge(item,[current])[0].scopeBasis,'exact_model_in_official_document');
});


test('不含型号的手册必须保留准确厂家父页及实际链接链，不能只贴一个继承标签',t=>{
 const f=validationFixture('.runtime/finals-linked-scope-'+crypto.randomUUID());t.after(()=>f.db.close());const id=f.add('[合成]真实链接链测试','其他','Sony','SYNTH-LINK-A'),item=f.read().items.find(i=>i.id===id)!,url='https://www.sony.com/manuals/synth-link-guide.pdf';const parent=makeKnowledgeDocument({url:'https://www.sony.com/product/synth-link-a/',title:item.model,text:item.model+' Synthetic exact product.',links:[{url,title:'Operating instructions user manual'}]},item,[]),child={...makeKnowledgeDocument({url,title:'Operating instructions',text:'Synthetic chapter without model identity. This is not a real operation.',links:[]},item,[parent.url,url]),applicability:'manufacturer_linked_manual'};
 assert.equal(scopedProductKnowledge(item,[parent,child]).length,2,'保留实际厂家链接的正文');
 assert.equal(scopedProductKnowledge(item,[{...parent,sections:[]},child]).length,1,'移除父页真实链接后继承不再有效');
 assert.equal(scopedProductKnowledge(item,[parent,{...child,chain:[]}]).length,1,'继承标签不代替来源链');
});


test('显式商品SKU清单优先于页尾提及：另一变体不能借正文出现当前型号而复用',t=>{
 const f=validationFixture('.runtime/finals-explicit-sku-'+crypto.randomUUID());t.after(()=>f.db.close());const id=f.add('[合成]SKU边界','其他','Sony','SYNTH-SKU-1'),item=f.read().items.find(i=>i.id===id)!;const wrong={...makeKnowledgeDocument({url:'https://www.sony.com/product/synth-sku-1-pro',title:'SYNTH-SKU-1-PRO',text:'SYNTH-SKU-1-PRO specifications. Related products: SYNTH-SKU-1. Synthetic source.',links:[]},item,[]),productModels:['SYNTH-SKU-1-PRO']};assert.equal(scopedProductKnowledge(item,[wrong]).length,0);
});
