import test from "node:test";
import assert from "node:assert/strict";
import { bindReviewedFacts, checkProposition, sourceReviews } from "../src/lib/foundation/reviewed-facts.ts";
import { makeKnowledgeDocument } from "../src/lib/life/acquisition.ts";
import { multilingualAnchors } from "../src/lib/life/retrieval-topics.ts";
import type { Item } from "../src/lib/domain.ts";

const docs=sourceReviews.map(r=>makeKnowledgeDocument({url:r.url,title:r.model,text:r.model+"\n"+r.predicate.replaceAll("_"," ")+"\n"+r.quote,links:[]},{model:r.model,brand:"test"} as Item,[],r.region));
test("逐字存在不证明任意主张：未提ANC、价格、保修和近似型号都缺证",()=>{
 const facts=bindReviewedFacts(docs), base={model:"WH-CH520",region:"unspecified"};
 for(const [predicate,value] of [["active_noise_cancellation",false],["repair_price",99],["warranty_years",2]] as const)
   assert.equal(checkProposition({...base,predicate,value},facts).verdict,"not_found");
 assert.equal(checkProposition({...base,model:"WH-CH720N",predicate:"subsequent_pairing_hold_seconds",value:5},facts).verdict,"not_found");
 assert.equal(checkProposition({...base,firmware:"9.9",predicate:"subsequent_pairing_hold_seconds",value:5},facts).verdict,"not_found");
});
test("直接支持与明确反驳针对同一命题；不把N/A推广到其他型号或地区",()=>{
 const facts=bindReviewedFacts(docs);
 assert.equal(checkProposition({model:"M185",region:"my",predicate:"battery",value:"1xAA alkaline"},facts).verdict,"supported");
 assert.equal(checkProposition({model:"M185",region:"my",predicate:"receiver_bluetooth_feature",value:true},facts).verdict,"refuted");
 assert.equal(checkProposition({model:"M185",region:"cn",predicate:"receiver_bluetooth_feature",value:true},facts).verdict,"not_found");
 assert.equal(checkProposition({model:"494.408.37",region:"jp",predicate:"food_contact_approved",value:true},facts).verdict,"refuted");
 assert.equal(checkProposition({model:"Osmo Mobile 6",region:"unspecified",predicate:"phone_weight_g",value:[170,290]},facts).verdict,"supported");
});
test("来源原文变化/假URL/JSON伪造审阅标记不能注册事实，冲突不自动择一",()=>{
 const facts=bindReviewedFacts(docs), request={model:"WH-CH520",region:"unspecified",predicate:"initialize_hold_seconds",value:10};
 assert.equal(checkProposition(request,[...facts,...facts.filter(f=>f.predicate===request.predicate&&f.region===request.region).map(f=>({...f,value:7}))]).verdict,"conflicting");
 assert.equal(checkProposition(request,JSON.parse(JSON.stringify(facts))).verdict,"not_found");
 assert.equal(bindReviewedFacts(docs.map(d=>({...d,url:"https://example.com/fake"}))).length,0);
 assert.equal(bindReviewedFacts(docs.map(d=>({...d,text:"Changed page."}))).length,0);
});
test("中文配对与初始化问题能找到英文后部操作，保留不同主题和条件",()=>{
 const chunks=docs.flatMap(d=>d.chunks), unrelated=Array.from({length:12},(_,i)=>({...chunks[0],id:"u"+i,text:"Product specifications and other unrelated introductory information."}));
 const selected=multilingualAnchors("耳机如何配对以及初始化？",[...unrelated,...chunks]);
 assert.ok(selected.some(c=>c.text.includes("5 seconds")));assert.ok(selected.some(c=>c.text.includes("10 seconds")));
});
