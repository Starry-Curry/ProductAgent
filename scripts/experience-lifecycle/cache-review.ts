import fs from "node:fs";
import assert from "node:assert/strict";
import { bindReviewedFacts,checkProposition } from "../../src/lib/foundation/reviewed-facts.ts";
import { checkNumericRange } from "../../src/lib/foundation/evidence.ts";
const docs=JSON.parse(fs.readFileSync(".runtime/official-audit-documents.json","utf8")),facts=bindReviewedFacts(docs);
const cases=[
 {model:"WH-CH520",region:"unspecified",predicate:"active_noise_cancellation",value:false,expected:"not_found"},
 {model:"WH-CH520",region:"unspecified",predicate:"repair_price",value:99,expected:"not_found"},
 {model:"WH-CH520",region:"unspecified",predicate:"subsequent_pairing_hold_seconds",value:5,expected:"supported"},
 {model:"WH-CH720N",region:"unspecified",predicate:"subsequent_pairing_hold_seconds",value:5,expected:"not_found"},
 {model:"WH-CH520",region:"cn",predicate:"initialize_hold_seconds",value:10,expected:"not_found"},
 {model:"M185",region:"my",predicate:"battery",value:"1xAA alkaline",expected:"supported"},
 {model:"M185",region:"my",predicate:"receiver_bluetooth_feature",value:true,expected:"refuted"},
 {model:"Osmo Mobile 6",region:"unspecified",predicate:"phone_weight_g",value:[170,290],expected:"supported"},
];
const rows=cases.map(c=>{const result=checkProposition(c,facts);assert.equal(result.verdict,c.expected);return {...c,result};});
assert.equal(checkNumericRange(310,170,290).verdict,"refuted");
fs.writeFileSync("docs/engineering/experience-lifecycle-2026-10-31/evidence/cache-review.json",JSON.stringify({at:new Date().toISOString(),networkReusedFrom:"official-fetch.json",newNetworkRequests:0,paidCalls:0,verifiedAtoms:facts.length,rows,dimensionOnly:checkNumericRange(310,170,290),note:"读取本轮真实抓取的本地缓存进行确定性核对，不是新增联网或真实模型回答。SAMLA读取受限未冒充成功。"},null,2));
console.log(JSON.stringify({assertions:9,verifiedAtoms:facts.length,paidCalls:0}));
