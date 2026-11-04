import test from 'node:test';import assert from 'node:assert/strict';import {makeKnowledgeDocument} from '../src/lib/life/acquisition.ts';
const item={id:'region-fixture',name:'[合成]地区编码检查',owner:'lin',brand:'Synthetic',model:'SYNTH-JP-11',category:'其他',state:'在用'} as any;
function region(url:string){return makeKnowledgeDocument({url,title:item.model,text:item.model+' Synthetic country scope protocol only.',links:[]},item,[]).region;}
test('国家域名可标记来源市场，语言前缀与拼接欺骗不能伪造地区，显式地区路径优先',()=>{
 assert.equal(region('https://www.example.jp/info/manual.pdf'),'jp');assert.equal(region('https://example.co.jp/info/manual.pdf'),'jp');assert.equal(region('https://example.cn/product/spec'),'cn');assert.equal(region('https://example.co.uk/support/manual'),'uk');
 assert.equal(region('https://example.com/en/manual.pdf'),'unspecified');assert.equal(region('https://example.com/ja/manual.pdf'),'unspecified');assert.equal(region('https://example.jp.evil.com/manual.pdf'),'unspecified');assert.equal(region('https://example.com/manual-jp.pdf'),'unspecified');
 assert.equal(region('https://example.jp/en-us/manual.pdf'),'us');assert.equal(region('https://example.com/en-gb/manual.pdf'),'uk');
});
