import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceReviews,bindReviewedFacts,checkProposition } from '../src/lib/foundation/reviewed-facts.ts';
import { makeKnowledgeDocument } from '../src/lib/life/acquisition.ts';
import type { Item } from '../src/lib/domain.ts';
test('WF-1000XM4路径不能注册WH-CH520的7秒初始化事实',()=>{
 const doc=makeKnowledgeDocument({url:'https://www.sony.co.uk/electronics/support/wireless-headphones-bluetooth-headphones/wf-1000xm4/articles/00297348',title:'Support article',text:'WH-CH520 for 7 seconds or more',links:[]},{model:'WH-CH520'} as Item,[],'uk');
 assert.equal(bindReviewedFacts([doc]).length,0);
 assert.ok(!sourceReviews.some(r=>r.model==='WH-CH520'&&r.url.includes('wf-1000xm4')));
});
test('WH-CH520官方帮助指南初始化约10秒以上，不能替换为7秒',()=>{
 const r=sourceReviews.find(r=>r.predicate==='initialize_hold_seconds')!;
 const doc=makeKnowledgeDocument({url:r.url,title:'WH-CH520 initialization',text:r.quote,links:[]},{model:r.model} as Item,[],'unspecified');
 const facts=bindReviewedFacts([doc]);
 assert.equal(checkProposition({model:r.model,region:'unspecified',predicate:r.predicate,value:10},facts).verdict,'supported');
 assert.equal(checkProposition({model:r.model,region:'unspecified',predicate:r.predicate,value:7},facts).verdict,'refuted');
});
