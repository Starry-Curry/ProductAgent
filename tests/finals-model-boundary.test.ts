import test from 'node:test';import assert from 'node:assert/strict';
import {modelMentioned} from '../src/lib/life/knowledge.ts';
import {exactProductSubject,makeKnowledgeDocument} from '../src/lib/life/acquisition.ts';
import {validationFixture} from '../scripts/life-validation-fixture.ts';
test('完整型号不能借点号、斜杠或横线变体获得适用性；文件扩展名不算型号后缀',()=>{
 for(const suffix of ['.3','.T','-PRO','/B','A','_V2'])assert.equal(modelMentioned('Product 1.3703'+suffix,'1.3703'),false,suffix);
 for(const text of ['Product 1.3703','Model 1.3703. See instructions.','manual-1.3703.pdf','https://example.com/1.3703.html?x=1'])assert.equal(modelMentioned(text,'1.3703'),true,text);
 assert.equal(modelMentioned('PT-D210 manual','PT D210'),true);
});
test('产品页只能以当前型号为主体，不凭相近SKU标题认证或在缓存中复用',t=>{
 const f=validationFixture('.runtime/finals-model-boundary-'+crypto.randomUUID());t.after(()=>f.db.close());const id=f.add('[合成]变体工具','工具','UNSEEN','1.3703');const item=f.read().items.find(i=>i.id===id)!;
 const doc=makeKnowledgeDocument({url:'https://example.com/product',title:'Climber 1.3703.3',text:'Variant 1.3703.3. This fixture is not actual product evidence.',links:[]},item,[]);
 assert.equal(exactProductSubject(doc,item.model),false);
 const variants={...doc,title:'Climber 1.3703',productModels:['1.3703.3','1.3703.T']};assert.equal(exactProductSubject(variants,item.model),false,'显式商品SKU不能被宽泛标题覆盖');
 assert.equal(exactProductSubject({...variants,productModels:['1.3703','1.3703.T']},item.model),true,'真正列出当前SKU的多型号正文仍可参与核对');
});
