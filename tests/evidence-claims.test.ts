import test from "node:test";
import assert from "node:assert/strict";
import { extractPublicHTML } from "../src/lib/life/sources.ts";
import { modelMentioned } from "../src/lib/life/knowledge.ts";
test("官网相邻参数单元格保留边界，不放宽近似型号匹配",async()=>{
 const d=await extractPublicHTML('<main><div>Model no:<span>MJTD01SYL</span></div><div>Color:<span>White</span></div><div>Article number<span>703.518.86</span></div><div>Materials<span>Wood</span></div></main>','https://www.mi.com/test');
 assert.ok(modelMentioned(d.text,'MJTD01SYL'));assert.ok(modelMentioned(d.text,'703.518.86'));assert.equal(modelMentioned(d.text,'MJTD01YL'),false);
});
import {
  adjudicateClaim,
  checkNumericRange,
} from "../src/lib/foundation/evidence.ts";
const chunk = {
  id: "p",
  documentId: "d",
  model: "SAMLA 494.408.37",
  region: "JP",
  text: "Not approved for food contact.",
  start: 0,
  end: 30,
  category: "limitation",
  url: "https://www.ikea.com/",
  title: "Synthetic excerpt fixture",
};
const input = {
  modelKey: "m",
  model: chunk.model,
  region: chunk.region,
  predicate: "food_contact",
  value: chunk.text,
};
test("原文、反证、缺证和人工标记冲突是不同状态；不能以缺席否定", () => {
  const ref = { chunk, quote: chunk.text, fetchedAt: "2026-10-30" };
  assert.equal(
    adjudicateClaim({ ...input, supports: [{ ...ref, stance: "refutes" }] })
      .verdict,
    "refuted",
  );
  assert.equal(
    adjudicateClaim({ ...input, supports: [{ ...ref, stance: "supports" }] })
      .verdict,
    "supported",
  );
  // Opposing annotations on the same literal excerpt are ambiguous, not resolved by a model vote.
  assert.equal(
    adjudicateClaim({
      ...input,
      supports: [
        { ...ref, stance: "supports" },
        { ...ref, stance: "refutes" },
      ],
    }).verdict,
    "conflicting",
  );
  assert.equal(
    adjudicateClaim({ ...input, supports: [] }).verdict,
    "not_found",
  );
  assert.equal(
    adjudicateClaim({
      ...input,
      value: "厂家承诺耐热100度",
      supports: [{ ...ref, stance: "supports" }],
    }).verdict,
    "not_found",
  );
  assert.equal(
    adjudicateClaim({
      ...input,
      region: "CN",
      supports: [{ ...ref, stance: "supports" }],
    }).verdict,
    "not_found",
  );
  assert.equal(checkNumericRange(310, 170, 290).verdict, "refuted");
  assert.throws(() => checkNumericRange(NaN, 170, 290));
});
