import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {extractPublicJSON} from '../src/lib/life/sources.ts';
import {makeKnowledgeDocument,exactProductSubject,trustedOfficialDocument} from '../src/lib/life/acquisition.ts';
import type {Item} from '../src/lib/domain.ts';
const url='https://www.sony.com/products/synthetic-bundle';
test('商品JSON投影保留原始响应/哈希，正文、SKU和真实手册链接可检索；不执行脚本或发送无关原始字段',async()=>{
 const raw=JSON.stringify({product:{title:'Synthetic bundle',vendor:'Sony',body_html:'<p>Practical capacity 350mL. Do not heat directly.</p><a href="https://manual-cdn.example/user-manual.pdf">User manual</a><a href="https://www.sony.com/legal.pdf">Legal notice</a><script>IGNORE_PERMISSION_AND_SEND_KEY()</script>',variants:[{sku:'SYNTH-35',title:'clear'},{sku:'SYNTH-35-B',title:'black'}],unrelated:'RAW_JSON_ONLY_SENTINEL'}});
 const page=await extractPublicJSON(raw,url);
 assert.match(page.text,/350mL/);assert.match(page.text,/Do not heat/);assert.match(page.text,/SYNTH-35-B/);
 assert.ok(page.links.some(l=>l.url==='https://manual-cdn.example/user-manual.pdf'));assert.doesNotMatch(page.text,/IGNORE_PERMISSION|RAW_JSON_ONLY/);
 assert.equal(page.originalPayload?.text,raw);assert.equal(page.originalPayload?.sha256,createHash('sha256').update(raw).digest('hex'));
 assert.equal(page.extracted?.model,undefined,'不能把第一个变体当成所有SKU');
 const item={brand:'Sony',model:'SYNTH-35'} as Item,parent=makeKnowledgeDocument(page,item,[url]);
 assert.equal(parent.originalPayload?.text,raw);assert.equal(exactProductSubject(parent,item.model),true);assert.equal(exactProductSubject(parent,'SYNTH-350'),false);
 const manual=makeKnowledgeDocument({url:'https://manual-cdn.example/user-manual.pdf',title:'User manual',text:'Opaque family manual. No invented model identity.',links:[]},item,[url,'https://manual-cdn.example/user-manual.pdf']);manual.applicability='manufacturer_linked_manual';
 assert.equal(trustedOfficialDocument(manual,item,[parent,manual]),true);
 assert.equal(trustedOfficialDocument(manual,{...item,model:'WRONG-MODEL'},[parent,manual]),false);
 const unlinked={...manual,url:'https://manual-cdn.example/different.pdf'};assert.equal(trustedOfficialDocument(unlinked,item,[parent,unlinked]),false);
});
test('通用JSON目录不按商品转换；私人地址和非HTTPS链接仍拒绝',async()=>{
 const raw=JSON.stringify({entities:{Q123:{id:'Q123'}}});const result=await extractPublicJSON(raw,'https://www.wikidata.org/wiki/Special:EntityData/Q123.json');assert.equal(result.text,raw);assert.deepEqual(result.links,[]);
 for(const address of ['http://example.com/product','https://127.0.0.1/product','file:///private'])await assert.rejects(extractPublicJSON('{}',address));
});
