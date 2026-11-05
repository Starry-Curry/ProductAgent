import test from 'node:test';import assert from 'node:assert/strict';import {practicalToolSet} from '../src/lib/agent/practical.ts';
test('未取得原文时不向模型宣传不可能成功的读页/图示入口；保留正常发现与条件设想',()=>{
 const tools=practicalToolSet([],['owned-1'],{sourceIds:[],sectionURLs:[]});assert.ok(!tools.some(t=>['read_official_page','inspect_manual_visual'].includes(t.function.name)));
 const search=tools.find(t=>t.function.name==='search_product_knowledge')!;assert.equal((search.function.parameters as any).properties.sourceUrl,undefined);assert.equal((search.function.parameters as any).additionalProperties,false);
 for(const name of ['complete_answer','search_product_knowledge','get_item_context','prepare_action'])assert.ok(tools.some(t=>t.function.name===name));
});
test('读页工具只宣传当前授权原文ID和真实章节；每轮替换，不保留旧权限引用',()=>{
 const tools=practicalToolSet(['fresh-original'],['owned-1'],{sourceIds:['fresh-document','fresh-original'],sectionURLs:['https://maker.example/manual#current']});
 for(const name of ['read_official_page','inspect_manual_visual'])assert.deepEqual((tools.find(t=>t.function.name===name)!.function.parameters as any).properties.sourceId.enum,['fresh-document','fresh-original']);
 assert.deepEqual((tools.find(t=>t.function.name==='search_product_knowledge')!.function.parameters as any).properties.sourceUrl.enum,['https://maker.example/manual#current']);
 const after=practicalToolSet([],['owned-2'],{sourceIds:[],sectionURLs:[]});assert.ok(!JSON.stringify(after).includes('fresh-document'));assert.ok(!JSON.stringify(after).includes('maker.example'));
});
