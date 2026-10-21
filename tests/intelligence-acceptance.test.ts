import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { auditIdeaActions } from "../src/lib/life/idea-audit.ts";
import { taskStepCovers } from "../src/lib/life/knowledge-task.ts";
import {
  groundedReply,
  quoteInSource,
} from "../src/lib/skills/document-help.ts";
import { routeProductTurn } from "../src/lib/home/router.ts";
import { validationFixture } from "../scripts/life-validation-fixture.ts";
import { modelIdea } from "../src/lib/life/ideas.ts";
import { completedStepOrdinals } from "../src/lib/agent/service.ts";
import { continueVerifiedGuidance } from "../src/lib/agent/guidance-continuation.ts";

test("用户批量报告完成按可见序号记录，否定和重复不误进度", () => {
  assert.deepEqual(completedStepOrdinals("前两步已经完成，继续"), [1, 2]);
  assert.deepEqual(completedStepOrdinals("第1步和第3步都已完成"), [1, 3]);
  assert.deepEqual(completedStepOrdinals("前两步还没有完成"), []);
});

test("纯进度续接沿用有据剩余步骤，条件变化、过期来源与私人记忆不复用", () => {
  const session: any = {
    tried: ["one"],
    messages: [
      {
        reply: {
          source: "model-with-evidence",
          memoryIds: [],
          evidenceIds: ["d:0"],
          steps: [
            { id: "one", text: "清洁" },
            { id: "two", text: "装料" },
          ],
        },
      },
    ],
  };
  const ids = new Set(["d:0"]);
  assert.deepEqual(
    continueVerifiedGuidance(
      session,
      "第一步已经完成，下一步呢？还没决定食材和份量。",
      ids,
    )?.steps,
    [{ id: "two", text: "装料" }],
  );
  assert.equal(
    continueVerifiedGuidance(session, "第一步已经完成，但机器冒烟", ids),
    undefined,
  );
  assert.equal(
    continueVerifiedGuidance(session, "第一步已经完成，换成冷冻鱼", ids),
    undefined,
  );
  assert.equal(
    continueVerifiedGuidance(session, "第一步已经完成，继续", new Set()),
    undefined,
  );
  session.messages[0].reply.memoryIds = ["private"];
  assert.equal(
    continueVerifiedGuidance(session, "第一步已经完成，继续", ids),
    undefined,
  );
});

test("真实失败动作回归：数字照片、隐含杂物、精确计时、罩灯、墨迹投影与未证实效果", () => {
  const items: any = [
    { id: "c", name: "数码相机", category: "电子设备" },
    { id: "p", name: "纸笔", category: "文具" },
    { id: "g", name: "玻璃杯", category: "容器" },
    { id: "l", name: "手电筒", category: "照明" },
  ];
  for (const [text, code] of [
    ["在照片背面写下感想", "digital-physical"],
    ["将桌面杂物分类收进杯中", "unconfirmed-subject"],
    ["每轮严格30秒，写下词语", "implicit-tool"],
    ["限时三分钟写作，时间到结束", "implicit-tool"],
    ["对着镜子检查搭配", "implicit-tool"],
    ["将明天必带的小件零散物品放在围巾中央", "unconfirmed-subject"],
    ["导出照片并拼成九宫格图", "implicit-tool"],
    ["用另一种颜色笔修正地图", "implicit-tool"],
    ["将杯子正立罩住灯头，确保光晕", "heat-obstruction"],
    ["照亮纸上的轮廓，使其投影到墙面", "ink-projection"],
    ["透过杯子就会形成清晰彩虹", "unverified-effect"],
  ]) {
    const result = auditIdeaActions("只用登记物品，不使用计时工具", items, {
      itemIds: items.map((i: any) => i.id),
      steps: [text],
    });
    assert.ok(
      result.issues.some((i) => i.code === code),
      JSON.stringify({ text, result }),
    );
  }
  const good = auditIdeaActions("只用登记物品做摄影创作", items, {
    itemIds: ["c", "p"],
    steps: ["拍下三张照片，在纸上记录文件编号和各自的感想"],
  });
  assert.equal(good.issues.length, 0);
  assert.deepEqual(good.resources.owned, ["c", "p"]);
  assert.ok(
    auditIdeaActions("只用已有物品整理桌面", items, {
      itemIds: ["g", "p"],
      steps: ["将杯子倒扣作底座", "把笔记本插入杯口"],
    }).issues.some((i) => i.code === "inconsistent-geometry"),
  );
  assert.ok(
    auditIdeaActions("摄影散步", items, {
      itemIds: ["c"],
      steps: ["走路时始终框住前方移动目标"],
    }).issues.some((i) => i.code === "unsafe-attention"),
  );
});

test("引文序列化修复与逐句定位不放过改写、数字或无据句子", () => {
  assert.equal(
    quoteInSource("Press the bu\u001con.", "Press the bu\\u001con."),
    true,
  );
  const evidence: any = [
    {
      id: "a",
      documentId: "d",
      start: 0,
      end: 130,
      model: "TEST",
      category: "operation",
      title: "TEST",
      text: "Press power. Check readiness first. Select program. Use 5 V only.",
      url: "https://example.org",
    },
  ];
  const value = {
    kind: "grounded",
    answer: "开始",
    steps: [
      {
        phase: "start",
        text: "按电源按钮，选择程序",
        sourceIds: ["a"],
        sourceQuote: "Press power. Select program.",
      },
    ],
  };
  assert.equal(groundedReply(value, evidence, { tried: [] }).steps.length, 1);
  assert.throws(
    () =>
      groundedReply(
        {
          ...value,
          steps: [
            { ...value.steps[0], sourceQuote: "Press power. Use 9 V only." },
          ],
        },
        evidence,
        { tried: [] },
      ),
    /引文/,
  );
});
test("任务覆盖核对动作目标，非装料句和运行中调参不能冒充装料/选程序", () => {
  assert.equal(
    taskStepCovers("load", "将炸盘放入篮子；如需分层放置食材，请使用烤架"),
    false,
  );
  assert.equal(taskStepCovers("load", "空篮运行，不放入任何食材"), false);
  assert.equal(
    taskStepCovers("load", "将炸盘放入篮子，再将食材逐一加入篮中"),
    true,
  );
  assert.equal(
    taskStepCovers("program", "运行中调整温度，否则按原设定继续运行"),
    false,
  );
  assert.equal(
    taskStepCovers("program", "选择手动程序，设置温度与时间并确认启动"),
    true,
  );
});
test("引用定位仅补全同文档相邻块，参数以实际逐步引文为界", () => {
  const text =
    "Model TEST. Press the power button and select the cooking program. Wait five minutes. Use a 5 V adapter.";
  const evidence: any = [
    {
      id: "a",
      documentId: "doc",
      start: 0,
      end: 60,
      text: text.slice(0, 60),
      model: "TEST",
      category: "operation",
      title: "TEST",
      url: "https://example.org/manual",
    },
    {
      id: "b",
      documentId: "doc",
      start: 40,
      end: text.length,
      text: text.slice(40),
      model: "TEST",
      category: "operation",
      title: "TEST",
      url: "https://example.org/manual",
    },
  ];
  const p = {
    kind: "grounded",
    answer: "开始",
    steps: [
      {
        phase: "configure",
        text: "按电源按钮并选择程序",
        sourceIds: ["a"],
        sourceQuote: "Press the power button and select the cooking program.",
      },
    ],
  };
  const r = groundedReply(p, evidence, { tried: [] });
  assert.equal(r.steps.length, 1);
  assert.ok(r.evidenceIds.includes("b"));
  assert.throws(
    () =>
      groundedReply(
        { ...p, steps: [{ ...p.steps[0], text: "等待5分钟" }] },
        evidence,
        { tried: [] },
      ),
    /数字|来源/,
  );
});
test("当前物品的第一次充电进入服务，普通聊天仍自然；局部补丁保留原方案且不多次重试", async () => {
  const t = validationFixture(
    fs.mkdtempSync(path.join(process.cwd(), ".runtime", "intelligence-unit-")),
  );
  try {
    const id = t.add("耳机", "电子设备", "Sony", "WH-CH720N");
    const session: any = {
      itemId: id,
      known: { uiPage: "item" },
      messages: [],
      tried: [],
    };
    assert.equal(
      routeProductTurn(
        "第一次充电，从准备到充完带我做一次。",
        t.read(),
        "lin",
        session,
      ).intent,
      "help",
    );
    assert.equal(
      routeProductTurn("今天很累，随便聊聊", t.read(), "lin", session).intent,
      "companion",
    );
    const paper = t.add("纸笔", "文具", "", "");
    let calls = 0;
    const r = await modelIdea(
      t.db,
      t.read(),
      "lin",
      "只用纸笔做游戏",
      {
        model: "offline",
        generate: async () => ({
          model: "offline",
          tokens: null,
          text: JSON.stringify(
            ++calls === 1
              ? {
                  title: "词语接龙",
                  itemIds: [paper],
                  minutes: 5,
                  steps: ["严格30秒内写三个词"],
                  limits: [],
                }
              : {
                  patches: [
                    {
                      index: 0,
                      steps: ["写三个词，再用它们连成一句话"],
                      missing: [],
                      limits: ["不用计时设备"],
                    },
                  ],
                },
          ),
        }),
      },
      false,
      t.read,
      { itemIds: [paper] },
    );
    assert.equal(calls, 2);
    assert.equal(r.title, "词语接龙");
    assert.ok(!r.steps.some((s) => s.includes("30秒")));
    assert.equal(r.resourceAudit?.unconfirmed.length, 0);
  } finally {
    t.db.close();
  }
});
