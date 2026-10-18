import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { State } from "../domain.ts";
import type { MemoryRecord } from "../agent/contracts.ts";
import { findPack } from "../products.ts";
import { householdCases, HOUSEHOLD_DEMO_VERSION } from "./household-cases.ts";
export function demoMemoryId(caseId: string, index: number) {
  const h = createHash("sha256")
    .update(caseId + ":memory:" + index)
    .digest("hex");
  return (
    h.slice(0, 8) +
    "-" +
    h.slice(8, 12) +
    "-4" +
    h.slice(13, 16) +
    "-8" +
    h.slice(17, 20) +
    "-" +
    h.slice(20, 32)
  );
}
/** Add only reserved demo IDs once. Never reset a workspace or recreate deleted memories. */
export function installHouseholdCases(db: DatabaseSync) {
  if (
    db
      .prepare("SELECT 1 FROM demo_content_installations WHERE version=?")
      .get(HOUSEHOLD_DEMO_VERSION)
  )
    return;
  db.exec("BEGIN IMMEDIATE");
  try {
    if (
      db
        .prepare("SELECT 1 FROM demo_content_installations WHERE version=?")
        .get(HOUSEHOLD_DEMO_VERSION)
    ) {
      db.exec("COMMIT");
      return;
    }
    const state = JSON.parse(
      (
        db.prepare("SELECT body FROM workspace WHERE id=1").get() as {
          body: string;
        }
      ).body,
    ) as State;
    const at = "2026-10-18T00:00:00.000Z";
    for (const c of householdCases) {
      if (state.items.some((i) => i.id === c.id)) continue;
      const pack = findPack(c.packId);
      if (!pack) throw Error("Missing demo Product Pack");
      state.items.push({
        id: c.id,
        name: pack.product,
        category:
          c.icon === "shelf" || c.icon === "table" || c.icon === "trolley"
            ? "家具与收纳"
            : "家用电器",
        model: pack.model,
        location: c.location,
        owner: "lin",
        shared: true,
        state: "在用",
        icon: c.icon,
        note: "演示案例；商品资料来自官方地区页面，生活故事为合成内容。",
        source: "示例数据",
        demo: {
          caseId: c.id,
          title: c.title,
          summary: c.summary,
          questions: c.questions,
        },
        productBinding: {
          packId: pack.id,
          version: pack.version,
          confirmedBy: "lin",
          confirmedAt: at,
        },
      });
      c.stories.forEach((text, n) =>
        state.memories.push({
          id: c.id + "-story-" + n,
          itemId: c.id,
          author: "lin",
          text,
          at,
          shared: false,
          demo: true,
        }),
      );
      const memories = [
        { kind: "story", text: c.stories[0] },
        { kind: "relationship", text: c.stories[1] },
        { kind: "preference", text: c.preference },
      ] as const;
      memories.forEach((m, n) => {
        const record: MemoryRecord & { itemOwner: string } = {
          id: demoMemoryId(c.id, n),
          owner: "lin",
          itemId: c.id,
          itemOwner: "lin",
          kind: m.kind,
          text: m.text,
          status: "active",
          allowCloud: false,
          source: "automatic",
          demo: true,
          version: 1,
          createdAt: at,
          updatedAt: at,
          provenance: {
            kind: "story",
            sourceId: n < 2 ? c.id + "-story-" + n : c.id + ":preference",
            basis: "app_record",
            at,
            extractor: "household-demo-v1",
          },
        };
        // Stable IDs and install receipt protect later corrections/forget operations.
        db.prepare(
          "INSERT OR IGNORE INTO personal_memories VALUES(?,?,?,?,?,?)",
        ).run(
          record.id,
          record.owner,
          c.id,
          JSON.stringify(record),
          record.status,
          record.version,
        );
      });
    }
    for (const [key, title, assignee, kind] of [
      ["purifier", "一起核对净化器的资料和摆放位置", "dad", "help"],
      ["billy", "核对书架固定要求并记录待确认项", "lin", "notice"],
      ["vacuum", "周末一起收拾客厅的小角落", "dad", "clean"],
      ["fryer", "聚餐后确认清洁说明与收尾分工", "lin", "help"],
    ] as const) {
      const itemId = "demo-household-" + key;
      if (
        state.items.find((i) => i.id === itemId)?.demo &&
        !state.tasks.some((t) => t.id === itemId + "-task")
      )
        state.tasks.push({
          id: itemId + "-task",
          itemId,
          title: "[示例] " + title,
          assignee,
          status: "待处理",
          kind,
          logs: [
            {
              by: "lin",
              text: "合成家庭事项，仅用于体验；未验证设备或安装状态。",
              at,
            },
          ],
        });
    }
    for (const [key, goal, itemIds] of [
      [
        "reading",
        "[示例] 用已有家具整理一个阅读角",
        ["demo-household-billy", "demo-household-side-table", "lamp"],
      ],
      [
        "craft",
        "[示例] 把已有手作材料整理得更好找",
        ["demo-household-kallax", "demo-household-trolley", "beads"],
      ],
    ] as const) {
      if (!state.plans?.some((p) => p.id === "demo-plan-" + key)) {
        state.plans = state.plans || [];
        state.plans.push({
          id: "demo-plan-" + key,
          actor: "lin",
          goal,
          itemIds: [...itemIds],
          at,
          checklist: [{ label: "核对真实物品与适用条件", status: "待确认" }],
        });
      }
    }
    db.prepare("UPDATE workspace SET body=? WHERE id=1").run(
      JSON.stringify(state),
    );
    db.prepare("INSERT INTO demo_content_installations VALUES(?,?)").run(
      HOUSEHOLD_DEMO_VERSION,
      new Date().toISOString(),
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
