import test from "node:test";
import assert from "node:assert/strict";
import { reviewHomeAnswer } from "../src/lib/agent/source-review.ts";
import type { Provider } from "../src/lib/ai/provider.ts";
function reviewer(value: unknown): Provider {
  return {
    ready: true,
    model: "offline-review",
    generate: async () => ({
      text: JSON.stringify(value),
      model: "offline-review",
      tokens: null,
    }),
  };
}
test("来源复核只能删除原句和原步骤，不能偷偷生成新的摆放动作", async () => {
  const draft = {
    answer: "这幅画由小夏赠送。盒子可以稳稳支撑倾斜的画框。",
    steps: ["让画靠在盒子上。"],
  };
  const r = await reviewHomeAnswer(
    reviewer({
      keepSentenceIds: [0],
      keepStepIds: [],
      issues: ["未提供画框稳定支撑的依据"],
    }),
    {},
    draft,
    1000,
  );
  assert.ok(r.answer.startsWith("这幅画由小夏赠送。"));
  assert.ok(!r.answer.includes("盒子可以稳稳"));
  assert.deepEqual(r.steps, []);
  assert.equal(r.removed, true);
});
test("复核不能引用草稿外句子或夹带改写后的事实", async () => {
  await assert.rejects(
    () =>
      reviewHomeAnswer(
        reviewer({ keepSentenceIds: [1], keepStepIds: [], issues: [] }),
        {},
        { answer: "原句。", steps: [] },
        1000,
      ),
    /未知句子/,
  );
  await assert.rejects(
    () =>
      reviewHomeAnswer(
        reviewer({
          keepSentenceIds: [0],
          keepStepIds: [],
          issues: [],
          answer: "另外编写的事实",
        }),
        {},
        { answer: "原句。", steps: [] },
        1000,
      ),
    /未完成/,
  );
});
test("没有通过来源复核的完整方案，不作为一个已完成安排展示", async () => {
  const r = await reviewHomeAnswer(
    reviewer({
      keepSentenceIds: [],
      keepStepIds: [],
      issues: ["实际空间与支撑状态缺失"],
    }),
    {},
    { answer: "桌面已经布置好了。", steps: ["已控制台灯"] },
    1000,
  );
  assert.ok(r.answer.includes("资料还不足"));
  assert.deepEqual(r.steps, []);
});
