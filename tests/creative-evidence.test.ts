import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync, existsSync } from "node:fs";
import { validationFixture } from "../scripts/life-validation-fixture.ts";
import {
  importCreativeEvidence,
  listCreativeEvidence,
  searchWikibooks,
} from "../src/lib/life/creative-evidence.ts";
import { planDiscovery } from "../src/lib/life/planning.ts";
import { feedbackIdea, modelIdea } from "../src/lib/life/ideas.ts";
import { ProviderError } from "../src/lib/ai/provider.ts";
const fixture = () =>
  validationFixture(
    mkdtempSync(path.join(process.cwd(), ".runtime", "creative-test-")),
  );

test("公开经验受控改编使用实际来源/能力，不强制玻璃杯或未登记道具、不调用模型", async () => {
  const t = fixture();
  try {
    const light = t.add("手电筒", "电子设备", "合成", "L", {
        attributes: { capabilities: ["照明"] },
      }),
      paper = t.add("纸笔", "文具", "合成", "P", {
        attributes: { capabilities: ["书写"] },
      }),
      cup = t.add("玻璃杯", "厨房用品", "合成", "C");
    const e = await importCreativeEvidence(
      t.db,
      "lin",
      { url: "https://example.org/shadow" },
      async (url) => ({
        url,
        title: "Shadow game",
        text: "Use light and hands to play a shadow guessing game. A flat background must be checked first.",
        links: [],
      }),
    );
    const p = await planDiscovery(
      t.db,
      t.read(),
      "lin",
      {
        goal: "参考影子经验，只用手电筒和纸笔做十分钟游戏",
        itemIds: [light, paper, cup],
        creativeEvidenceIds: [e.id],
        model: false,
      },
      {
        ready: false,
        model: "offline",
        generate: async () => {
          throw Error("No model allowed");
        },
      },
      t.read,
    );
    assert.equal(p.modelCalls, 0);
    assert.equal(p.ideas[0].creativeEvidenceSources?.[0].id, e.id);
    assert.equal(p.ideas[0].source, "local-candidate");
    assert.ok(!p.ideas[0].itemIds.includes(cup));
    assert.ok(p.ideas[0].missing?.some((s) => s.includes("现场确认")));
    assert.equal(p.ideas[0].tested, false);
  } finally {
    t.db.close();
  }
});

test("真实失败回归：错误物理机制、隐含材料不可借有效来源ID绕过；失败回退诚实标注且最多一次定向修复", async () => {
  const t = fixture();
  try {
    const light = t.add("普通手电筒", "电子设备", "合成", "LIGHT", {
      attributes: { quantity: 1, capabilities: ["照明"] },
    });
    const cup = t.add("透明玻璃杯", "厨房用品", "合成", "CUP", {
      attributes: { quantity: 1, material: "玻璃" },
    });
    const paper = t.add("纸笔", "文具", "合成", "PAPER", {
      attributes: { quantity: 1 },
    });
    const evidence = await importCreativeEvidence(t.db, "lin", {
      text: "本人做过手影游戏。",
      confirmed: true,
    });
    const provider = {
      ready: true,
      model: "offline-replay",
      generate: async () => {
        throw Error("离线逐包验证禁止调用模型");
      },
    };
    const bad = [
      "用杯身凝露计时，等待三分钟。",
      "旋转干燥杯底，在纸上留下图案和印痕。",
      "倒扣杯子，将小东西放入杯沿与桌面夹出的环形凹槽。",
      "把纸上所画轮廓投影到墙面。",
      "剪下纸片，贴在墙上做游戏。",
      "杯中加入200ml清水，每次记录饮水量。",
    ];
    for (const step of bad) {
      await assert.rejects(
        modelIdea(
          t.db,
          t.read(),
          "lin",
          "只用手电筒、杯子和纸笔做活动",
          provider,
          false,
          t.read,
          {
            itemIds: [light, cup, paper],
            creativeEvidence: [evidence],
            precomputed: {
              model: provider.model,
              tokens: null,
              text: JSON.stringify({
                title: "待核对方案",
                itemIds: [light, cup, paper],
                minutes: 10,
                steps: [step],
                limits: ["不照眼睛，杯子放稳。"],
                creativeEvidenceIds: [evidence.id],
              }),
            },
          },
        ),
        /未经验证|未成立|未登记|尚未确认|未确认|尚未验证/,
      );
    }
    assert.equal(
      (t.db.prepare("SELECT count(*) n FROM life_ideas").get() as { n: number })
        .n,
      0,
    );
    let calls = 0;
    const fallback = await planDiscovery(
      t.db,
      t.read(),
      "lin",
      {
        goal: "只用现有物品整理桌面",
        itemIds: [light, cup, paper],
        engine: "legacy", model: true,
        publicEvidence: false,
      },
      {
        ...provider,
        generate: async () => {
          calls++;
          return {
            model: provider.model,
            tokens: null,
            text: JSON.stringify({
              title: "假凹槽收纳",
              itemIds: [cup],
              minutes: 10,
              steps: [bad[2]],
              limits: ["杯子放稳。"],
            }),
          };
        },
      },
      t.read,
    );
    assert.equal(calls, 2); // First draft + one reason-guided repair; neither may bypass physical checks.
    assert.equal(fallback.source, "rejected-model");
    assert.equal(fallback.cloudRejected, true);
    assert.equal(fallback.ideas.length, 0);
    assert.ok(fallback.missing.some((m) => m.includes("未用固定观察任务")));
    assert.ok(fallback.ideas.every((i) => i.source !== "model-creative"));
    await assert.rejects(
      planDiscovery(
        t.db,
        t.read(),
        "lin",
        {
          goal: "整理桌面",
          itemIds: [cup],
          engine: "legacy", model: true,
          publicEvidence: false,
        },
        {
          ...provider,
          generate: async () => {
            throw new ProviderError("network", "网络失败");
          },
        },
        t.read,
      ),
      (e: unknown) => e instanceof ProviderError && e.code === "network",
    );
  } finally {
    t.db.close();
  }
});
test("复核发生在候选发布前，不把草稿错误当成功；草稿和复核合计两次模型请求", async () => {
  const t = fixture();
  try {
    const cup = t.add("玻璃杯", "厨房用品", "合成", "CUP", {
      attributes: { quantity: 1 },
    });
    let calls = 0;
    const packet = (title: string, steps: string[]) => ({
      title,
      itemIds: [cup],
      minutes: 10,
      steps,
      limits: ["放稳杯子，不加热。"],
      direction: "生活改善",
    });
    const provider = {
      ready: true,
      model: "offline-protocol",
      generate: async () => {
        calls++;
        return {
          model: "offline-protocol",
          tokens: null,
          text: JSON.stringify(
            calls === 1
              ? packet("不可靠草稿", ["用凝露来计时。"])
              : {
                  ideas: [
                    packet("竖直杯收纳", [
                      "杯子正立放在平稳桌面，只收纳实际在手的笔。",
                    ]),
                  ],
                },
          ),
        };
      },
    };
    const result = await planDiscovery(
      t.db,
      t.read(),
      "lin",
      {
        goal: "用现有物品整理桌面",
        itemIds: [cup],
        engine: "legacy", model: true,
        review: true,
        publicEvidence: false,
      },
      provider,
      t.read,
    );
    assert.equal(calls, 2);
    assert.equal(result.modelCalls, 2);
    assert.equal(result.ideas[0].title, "竖直杯收纳");
    assert.equal(
      (
        t.db
          .prepare(
            "SELECT count(*) n FROM life_ideas WHERE body LIKE '%不可靠草稿%'",
          )
          .get() as { n: number }
      ).n,
      0,
    );
  } finally {
    t.db.close();
  }
});
test("公开来源保留链接及短摘录，用户内容要求权利确认；受限平台不自动读取，Wiki许可/版本可追踪", async () => {
  const t = fixture();
  try {
    let fetched = 0;
    const fetcher = async (url: string) => {
      fetched++;
      return {
        url,
        title: "公开游戏经验",
        text: "draw a shape using a moving shadow. ".repeat(100),
        links: [],
      };
    };
    const e = await importCreativeEvidence(
      t.db,
      "lin",
      { url: "https://example.org/game" },
      fetcher,
    );
    assert.ok(e.excerpt.length <= 180);
    assert.equal(e.kind, "third-party");
    assert.equal(
      (
        await importCreativeEvidence(
          t.db,
          "lin",
          { url: "https://example.org/game" },
          fetcher,
        )
      ).id,
      e.id,
    );
    await assert.rejects(
      importCreativeEvidence(
        t.db,
        "lin",
        { url: "https://www.xiaohongshu.com/explore/test" },
        fetcher,
      ),
      /不进行自动抓取/,
    );
    assert.equal(fetched, 2);
    await assert.rejects(
      importCreativeEvidence(t.db, "lin", { text: "本人经验" }),
      /有权使用/,
    );
    assert.equal(listCreativeEvidence(t.db, "dad").length, 0);
    const wiki = await searchWikibooks(
      t.db,
      "lin",
      "Cookbook:Oatmeal",
      async (url) => ({
        url,
        title: "json",
        text: JSON.stringify({
          query: {
            rightsinfo: {
              url: "https://creativecommons.org/licenses/by-sa/4.0/",
              text: "CC BY-SA 4.0",
            },
            pages: {
              1: {
                title: "Cookbook:Oatmeal",
                extract:
                  "Cook oats according to packaging, checking specific conditions.",
                fullurl: "https://en.wikibooks.org/wiki/Cookbook:Oatmeal",
                revisions: [{ revid: 123 }],
              },
            },
          },
        }),
        links: [],
      }),
    );
    assert.equal(wiki[0].revision, "123");
    assert.match(wiki[0].attribution, /contributors/);
    assert.equal(wiki[0].kind, "open-knowledge");
    await assert.rejects(
      searchWikibooks(t.db, "lin", "none", async (url) => ({
        url,
        title: "json",
        text: '{"query":{}}',
        links: [],
      })),
      /许可/,
    );
    assert.ok(existsSync(t.db.location()! + ".before-life-v4.sqlite"));
  } finally {
    t.db.close();
  }
});
test("一次真实协议替身可生成不同方向候选，逐个验证并保留收藏；来源ID不得跨用户", async () => {
  const t = fixture();
  try {
    const light = t.add("普通手电筒", "电子设备", "合成", "LIGHT", {
        attributes: { quantity: 1, capabilities: ["照明"] },
      }),
      cup = t.add("透明杯", "厨房用品", "合成", "CUP", {
        attributes: { quantity: 1, material: "玻璃" },
      });
    const e = await importCreativeEvidence(t.db, "lin", {
      text: "我的经验：把纸折成简单图形，以手电筒照射，轮流猜影子。",
      title: "本人游戏记录",
      confirmed: true,
    });
    let calls = 0;
    const provider = {
      ready: true,
      model: "offline-protocol",
      generate: async () => {
        calls++;
        return {
          model: "offline-protocol",
          tokens: null,
          text: JSON.stringify({
            ideas: [
              {
                direction: "娱乐",
                title: "影子猜形",
                itemIds: [light],
                minutes: 10,
                steps: ["照墙，用手势轮流猜影子。"],
                limits: ["不照眼睛，先确认墙面。"],
                missing: ["合适墙面待确认"],
                creativeEvidenceIds: [e.id],
              },
              {
                direction: "生活改善",
                title: "找桌面暗角",
                itemIds: [light],
                minutes: 10,
                steps: ["照亮桌面，标出需要整理的一角。"],
                limits: ["不拆灯具。"],
                creativeEvidenceIds: [],
              },
              {
                direction: "创作",
                title: "杯影速写",
                itemIds: [light, cup],
                minutes: 10,
                steps: ["杯子放稳，从旁照射，口述所见轮廓。"],
                limits: ["不保证特定光学效果；不照眼睛，防杯子跌落。"],
                creativeEvidenceIds: [],
              },
            ],
          }),
        };
      },
    };
    const input = {
      goal: "做不同方向的有趣活动",
      candidates: 3,
      itemIds: [light, cup],
      engine: "legacy", model: true,
      publicEvidence: false,
      creativeEvidenceIds: [e.id],
    };
    const first = await planDiscovery(
      t.db,
      t.read(),
      "lin",
      input,
      provider,
      t.read,
    );
    assert.equal(calls, 2);
    assert.equal(first.ideas.length, 3);
    assert.equal(first.ideas[0].creativeEvidenceSources?.[0].id, e.id);
    feedbackIdea(t.db, t.read(), "lin", {
      id: first.ideas[0].id,
      saved: true,
      outcome: "准备尝试",
    });
    const second = await planDiscovery(
      t.db,
      t.read(),
      "lin",
      input,
      provider,
      t.read,
    );
    assert.equal(second.ideas[0].id, first.ideas[0].id);
    assert.equal(second.ideas[0].saved, true);
    await assert.rejects(
      planDiscovery(
        t.db,
        t.read(),
        "dad",
        { ...input, itemIds: [], creativeEvidenceIds: [e.id] },
        provider,
        t.read,
      ),
      /不属于/,
    );
  } finally {
    t.db.close();
  }
});
