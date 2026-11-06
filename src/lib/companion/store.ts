import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canRead, mutate, type Person, type State } from "../domain.ts";
import { itemPhoto } from "../life/item-photos.ts";
import { AgentError } from "../agent/contracts.ts";
import { realAppliances } from "../catalog/real-appliances.ts";
import { friendships, socialMutation } from "./social.ts";
import { validTaskDate } from "./task-dates.ts";
import type { Friendship } from "./social-types.ts";
import type { EventProposal } from "./event-planning.ts";
import { inventoryTermMatches } from "./item-matching.ts";
import { calendarToday } from "./task-dates.ts";
import type { Task } from "../domain.ts";
import type { socialProfiles } from "./social-types.ts";

export type Preferences = {
  name: string;
  color: string;
  accessory: string;
  expression: string;
  style: "warm" | "neutral" | "playful";
  onboarded: boolean;
  elder: boolean;
};
export type Wish = {
  id: string;
  owner: Person;
  name: string;
  note: string;
  photo: string;
  url: string;
  shared: boolean;
  revision: number;
};
export type GiftNote = {
  id: string;
  owner: Person;
  recipient: Person;
  wishId: string;
  itemName: string;
  message: string;
  paper: string;
  url: string;
  revision: number;
  at: string;
};
export type CheckItem = {
  quantity?: string;
  reason?: string;
  priority?: "essential" | "recommended" | "optional";
  id: string;
  label: string;
  itemId?: string;
  group: "owned" | "missing" | "borrow";
  done: boolean;
  assignee: string;
};
export type SharedItem = {
  id: string;
  owner: Person;
  itemId: string;
  name: string;
  photo: string;
  note: string;
  revision: number;
};
export type SharedStory = {
  id: string;
  owner: Person;
  fragmentId: string;
  text: string;
  sourceRevision: number;
  at: string;
  revision: number;
};
export type Borrow = {
  id: string;
  owner: Person;
  recipient: Person;
  itemId: string;
  itemName: string;
  status:
    "requested" | "approved" | "declined" | "return_requested" | "returned";
  revision: number;
  at: string;
};
export type EventPlan = {
  id: string;
  owner: Person;
  goal: string;
  title: string;
  people: number;
  items: CheckItem[];
  warnings: string[];
  revision: number;
  at: string;
  source:
    "inventory-rules" | "assistant-plan" | "model-reviewed" | "model-draft";
  reviewNote?: string;
  model?: string;
  assumptions?: string[];
  scheduledDate?: string;
};
export const defaultPreferences: Preferences = {
  name: "阿圆",
  color: "original",
  accessory: "scarf",
  expression: "calm",
  style: "warm",
  onboarded: false,
  elder: false,
};
const person = z.enum(["lin", "dad", "friend"]);
const text = (max = 1000) => z.string().trim().max(max);
const url = z
  .string()
  .max(1500)
  .refine((v) => {
    if (!v) return true;
    try {
      const u = new URL(v);
      return u.protocol === "https:" && !u.username && !u.password;
    } catch {
      return false;
    }
  }, "请填写完整的 HTTPS 商品链接");
const photo = z
  .string()
  .max(1500)
  .refine(
    (v) =>
      !v ||
      /^\/demo\/[a-zA-Z0-9/_.-]+$/.test(v) ||
      /^\/api\/life\/media\/[a-f0-9-]+(?:\?actor=(?:lin|dad|friend))?$/.test(v),
    "照片地址无效",
  );
function setup(db: DatabaseSync) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS companion_records(id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1); CREATE INDEX IF NOT EXISTS companion_owner ON companion_records(owner,kind);",
  );
}
function records<T>(db: DatabaseSync, kind: string): T[] {
  return (
    db
      .prepare(
        "SELECT body FROM companion_records WHERE kind=? ORDER BY rowid DESC",
      )
      .all(kind) as { body: string }[]
  ).map((r) => JSON.parse(r.body));
}
function put<T extends { id: string; owner: string; revision?: number }>(
  db: DatabaseSync,
  kind: string,
  value: T,
) {
  db.prepare(
    "INSERT INTO companion_records(id,owner,kind,body,revision) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,revision=excluded.revision",
  ).run(
    value.id,
    value.owner,
    kind,
    JSON.stringify(value),
    value.revision || 1,
  );
}
function owned<T extends { id: string; owner: Person; revision: number }>(
  db: DatabaseSync,
  kind: string,
  actor: Person,
  input: any,
): T {
  const old = records<T>(db, kind).find((r) => r.id === input.id);
  if (!old || old.owner !== actor)
    throw new AgentError("记录不存在或不属于你", 403);
  if (old.revision !== input.revision)
    throw new AgentError("记录已更新，请刷新后再试", 409);
  return old;
}
export function companionData(db: DatabaseSync, actor: Person) {
  setup(db);
  const row = db.prepare("SELECT body FROM workspace WHERE id=1").get() as
    { body: string } | undefined;
  const workspace: State | undefined = row ? JSON.parse(row.body) : undefined;
  const imported = new Set(records<EventPlan>(db, "plan").map((p) => p.id));
  for (const p of workspace?.plans || []) {
    if (p.actor !== actor || p.preparation || imported.has(p.id)) continue;
    const checks: CheckItem[] = (p.checklist || []).map((c) => ({
      id: crypto.randomUUID(),
      label: c.label,
      done: /已完成|已准备|^done$/.test(c.status),
      group: "missing",
      assignee: "我",
    }));
    put(db, "plan", {
      id: p.id,
      owner: actor,
      goal: p.goal,
      title: p.goal.slice(0, 14),
      people: 2,
      items: checks,
      warnings: [],
      revision: 1,
      at: p.at,
      source: "assistant-plan",
    });
  }
  return {
    friendships: friendships(db, actor),
    preferences:
      records<any>(db, "preferences").find((p) => p.owner === actor)?.value ||
      defaultPreferences,
    wishes: records<Wish>(db, "wish").filter(
      (w) => w.owner === actor || w.shared,
    ),
    giftNotes: records<GiftNote>(db, "gift").filter((n) => n.owner === actor),
    sharedItems: records<SharedItem>(db, "shareItem"),
    sharedStories: records<SharedStory>(db, "shareStory").filter((s) => {
      const f = db
        .prepare("SELECT revision FROM life_fragments WHERE id=? AND owner=?")
        .get(s.fragmentId, s.owner) as { revision: number } | undefined;
      return f?.revision === s.sourceRevision;
    }),
    borrows: records<Borrow>(db, "borrow").filter(
      (b) => b.owner === actor || b.recipient === actor,
    ),
    plans: records<EventPlan>(db, "plan").filter((p) => p.owner === actor),
  };
}
export function createEventPlan(
  state: State,
  actor: Person,
  goal: string,
  proposal?: EventProposal,
): EventPlan {
  const items = state.items.filter((i) => canRead(i, actor) && !i.demo);
  const picnic = /野餐|露营|烧烤/.test(goal),
    photoTrip = /拍照|摄影/.test(goal),
    travel = /旅行|旅游|出差/.test(goal);
  const party = /party|派对|聚会|生日|看球|桌游|火锅/i.test(goal);
  const specs: [string, RegExp][] = party
    ? [
        ["餐食或零食", /零食|点心|饭菜|餐食/],
        ["聚会饮品", /饮料|果汁|汽水|茶叶|咖啡/],
        ["座位和可用桌面", /椅|沙发|餐桌|边桌/],
        ["音乐播放", /音箱|音响/],
        ["一起玩的桌游或纸牌", /桌游|纸牌|扑克/],
        ["垃圾袋与清洁用品", /垃圾袋|抹布/],
      ]
    : picnic
      ? [
          ["野餐垫", /野餐垫|地垫/],
          ["餐盒", /餐盒|饭盒/],
          ["保温杯", /保温杯|水杯/],
          ["饮用水", /饮用水|矿泉水/],
          ["冰袋", /冰袋/],
          ["垃圾袋", /垃圾袋/],
        ]
      : photoTrip
        ? [
            ["相机", /相机/],
            ["相机电池", /电池/],
            ["存储卡", /存储卡|内存卡/],
            ["背包", /背包/],
            ["饮用水", /饮用水|矿泉水/],
          ]
        : travel
          ? [
              ["背包", /背包|行李箱/],
              ["换洗衣物", /衣|衬衫/],
              ["充电器", /充电器/],
              ["洗漱用品", /洗漱|牙刷/],
              ["证件", /证件/],
            ]
          : [
              ["装东西的包", /背包|收纳篮/],
              ["饮用水", /饮用水|保温杯/],
              ["记录工具", /速写本|笔记本|铅笔/],
            ];
  const warnings: string[] = [];
  const requirements = proposal
    ? proposal.items
    : specs.map(([label, re]) => ({
        label,
        re,
        matchTerms: [] as string[],
        quantity: "按参与人数核对",
        reason: "为这次活动做准备",
        priority: "recommended" as const,
      }));
  const checks: CheckItem[] = requirements.map((requirement) => {
    const { label } = requirement;
    const terms = requirement.matchTerms.filter(
      (t) => !/^(?:物品|用品|东西|工具|设备|家电|食物)$/.test(t),
    );
    const matches = items.filter((i) =>
      "re" in requirement
        ? (requirement.re as RegExp).test(i.name)
        : terms.some((t) => inventoryTermMatches(i.name, t)),
    );
    const valid = matches.find(
      (i) =>
        !["broken", "loaned", "lost", "gifted", "consumed"].includes(
          i.availability || "",
        ) && !/损坏|维修|暂停|用尽/.test(i.state),
    );
    for (const i of matches.filter(
      (i) =>
        i !== valid &&
        (/损坏|维修|暂停/.test(i.state) || i.availability === "broken"),
    ))
      warnings.push(`${i.name}目前${i.state}，本次不计入可用物品。`);
    return {
      id: crypto.randomUUID(),
      label,
      quantity: requirement.quantity,
      reason: requirement.reason,
      priority: requirement.priority,
      itemId: valid?.id,
      group: valid ? "owned" : "missing",
      done: false,
      assignee: "我",
    };
  });
  const count = Number(
    goal.match(/(\d+)\s*[个人位]/)?.[1] || (/四[个人位]/.test(goal) ? 4 : 2),
  );
  return {
    id: crypto.randomUUID(),
    owner: actor,
    goal,
    title:
      proposal?.title ||
      (party
        ? "家庭聚会准备"
        : picnic
          ? "野餐准备"
          : photoTrip
            ? "摄影出行"
            : travel
              ? "旅行准备"
              : "活动准备"),
    people: proposal?.people || Math.max(1, Math.min(count, 100)),
    assumptions:
      proposal?.assumptions ||
      (party ? ["先按在家聊天、吃点东西和轻娱乐安排，可按实际人数调整。"] : []),
    scheduledDate: /明天/.test(goal)
      ? new Date(Date.parse(calendarToday() + "T00:00:00Z") + 86400000)
          .toISOString()
          .slice(0, 10)
      : /今天/.test(goal)
        ? calendarToday()
        : undefined,
    items: checks,
    warnings: [...new Set(warnings)],
    revision: 1,
    at: new Date().toISOString(),
    source: "inventory-rules",
  };
}
export type CompanionMutationResult = {
  preferences?: Preferences;
  wish?: Wish;
  giftNote?: GiftNote;
  plan?: EventPlan;
  task?: Task;
  borrow?: Borrow;
  ok?: boolean;
  profile?: (typeof socialProfiles)[number];
  relationship?: Friendship | null;
  friendship?: Friendship;
  alreadyExists?: boolean;
};
export function mutateCompanion(
  db: DatabaseSync,
  state: State,
  actor: Person,
  action: string,
  input: unknown,
  preparedPlan?: EventPlan,
): CompanionMutationResult {
  setup(db);
  if (["findFriend", "addFriend", "friendDecision"].includes(action))
    return socialMutation(db, actor, action, input)!;
  if (action === "preferences") {
    const value = z
      .object({
        name: text(24).min(1),
        color: z.enum(["original", "rose", "oat", "blue"]),
        accessory: z.enum(["scarf", "bow", "none"]),
        expression: z.enum(["calm", "happy", "sleepy"]),
        style: z.enum(["warm", "neutral", "playful"]),
        onboarded: z.boolean(),
        elder: z.boolean(),
      })
      .strict()
      .parse(input);
    put(db, "preferences", { id: "prefs:" + actor, owner: actor, value });
    return { preferences: value };
  }
  if (action === "wish") {
    const v = z
      .object({
        id: z.string().uuid().optional(),
        revision: z.number().int().optional(),
        name: text(100).min(1),
        note: text(1000),
        photo: photo.default(""),
        url: url.default(""),
        shared: z.boolean(),
      })
      .strict()
      .parse(input);
    if (v.photo.startsWith("/api/life/media/")) {
      const mediaId = v.photo.split("/media/")[1].split("?")[0];
      if (
        !db
          .prepare("SELECT 1 FROM life_media WHERE id=? AND owner=?")
          .get(mediaId, actor)
      )
        throw new AgentError("照片未获授权", 403);
    }
    const old = v.id ? owned<Wish>(db, "wish", actor, v) : null;
    const value = {
      ...v,
      id: old?.id || crypto.randomUUID(),
      owner: actor,
      revision: (old?.revision || 0) + 1,
    };
    put(db, "wish", value);
    return { wish: value };
  }
  if (action === "deleteWish") {
    const v = z
      .object({ id: z.string().uuid(), revision: z.number().int() })
      .parse(input);
    owned<Wish>(db, "wish", actor, v);
    db.prepare("DELETE FROM companion_records WHERE id=? AND owner=?").run(
      v.id,
      actor,
    );
    return { ok: true };
  }
  if (action === "giftNote") {
    const v = z
      .object({
        id: z.string().uuid().optional(),
        revision: z.number().int().optional(),
        wishId: z.string().uuid(),
        message: text(2000).min(1),
        paper: z.enum(["plain", "handwritten"]),
      })
      .strict()
      .parse(input);
    const wish = records<Wish>(db, "wish").find(
      (w) => w.id === v.wishId && (w.owner === actor || w.shared),
    );
    if (!wish || wish.owner === actor)
      throw new AgentError("请选择朋友公开的想买清单", 403);
    const old = v.id ? owned<GiftNote>(db, "gift", actor, v) : null;
    const value: GiftNote = {
      ...v,
      id: old?.id || crypto.randomUUID(),
      owner: actor,
      recipient: wish.owner,
      itemName: wish.name,
      url: wish.url,
      revision: (old?.revision || 0) + 1,
      at: new Date().toISOString(),
    };
    put(db, "gift", value);
    return { giftNote: value };
  }
  if (action === "deleteGiftNote") {
    const v = z
      .object({ id: z.string().uuid(), revision: z.number().int() })
      .parse(input);
    owned<GiftNote>(db, "gift", actor, v);
    db.prepare("DELETE FROM companion_records WHERE id=? AND owner=?").run(
      v.id,
      actor,
    );
    return { ok: true };
  }
  if (action === "createPlan") {
    const { goal } = z
      .object({ goal: text(1000).min(2) })
      .strict()
      .parse(input);
    const value = preparedPlan || createEventPlan(state, actor, goal);
    if (value.owner !== actor || value.goal !== goal)
      throw new AgentError("活动目标已变化，请重新生成", 409);
    for (const row of value.items) {
      const item = state.items.find(
        (i) => i.id === row.itemId && canRead(i, actor),
      );
      if (
        row.itemId &&
        (!item ||
          ["broken", "loaned", "lost", "gifted", "consumed"].includes(
            item.availability || "",
          ) ||
          /损坏|维修|暂停/.test(item.state))
      ) {
        row.itemId = undefined;
        row.group = "missing";
        value.warnings.push("生成期间物品状态已变化，已移出可用库存。");
      }
    }
    put(db, "plan", value);
    return { plan: value };
  }
  if (action === "updatePlan") {
    const v = z
      .object({
        id: z.string().uuid(),
        revision: z.number().int(),
        title: text(100).min(1),
        people: z.number().int().min(1).max(100),
        items: z
          .array(
            z
              .object({
                id: z.string().uuid(),
                label: text(120).min(1),
                itemId: z.string().max(100).optional(),
                group: z.enum(["owned", "missing", "borrow"]),
                done: z.boolean(),
                assignee: text(30).min(1),
                quantity: text(60).optional(),
                reason: text(160).optional(),
                priority: z
                  .enum(["essential", "recommended", "optional"])
                  .optional(),
              })
              .strict(),
          )
          .max(80),
      })
      .strict()
      .parse(input);
    const old = owned<EventPlan>(db, "plan", actor, v);
    for (const i of v.items)
      if (
        i.itemId &&
        !state.items.some((x) => x.id === i.itemId && canRead(x, actor))
      )
        throw new AgentError("清单中的物品未获授权", 403);
    const value = { ...old, ...v, revision: old.revision + 1 };
    put(db, "plan", value);
    const original = state.plans?.find(
      (p) => p.id === value.id && p.actor === actor && !p.preparation,
    );
    if (original) {
      original.checklist = value.items.map((i) => ({
        label: i.label,
        status: i.done ? "已完成" : "待准备",
      }));
      db.prepare("UPDATE workspace SET body=? WHERE id=1").run(
        JSON.stringify(state),
      );
    }
    return { plan: value };
  }
  if (action === "deletePlan") {
    const v = z
      .object({ id: z.string().uuid(), revision: z.number().int() })
      .parse(input);
    owned<EventPlan>(db, "plan", actor, v);
    db.prepare("DELETE FROM companion_records WHERE id=? AND owner=?").run(
      v.id,
      actor,
    );
    state.plans = (state.plans || []).filter(
      (p) => !(p.id === v.id && p.actor === actor && !p.preparation),
    );
    db.prepare("UPDATE workspace SET body=? WHERE id=1").run(
      JSON.stringify(state),
    );
    return { ok: true };
  }
  if (action === "reportTask") {
    const v = z
      .object({
        requestId: z.string().uuid(),
        title: text(120).min(1),
        kind: z.enum(["repair", "clean", "purchase", "notice", "help"]),
        assignee: person,
        itemId: text(100).default(""),
        stop: z.boolean().default(false),
        dueDate: z.string().optional(),
      })
      .strict()
      .parse(input);
    const prior = state.tasks.find(
      (t) => t.requestId === v.requestId && t.createdBy === actor,
    );
    if (prior) {
      if (
        prior.title !== v.title ||
        prior.kind !== v.kind ||
        prior.itemId !== v.itemId ||
        prior.dueDate !== validTaskDate(v.dueDate) ||
        prior.assignee !== v.assignee
      )
        throw new AgentError("重复请求的内容已变化", 409);
      return { task: prior };
    }
    let updated = mutate(state, actor, "quickTask", v);
    if (v.stop && v.itemId)
      updated = mutate(updated, actor, "updateItem", {
        itemId: v.itemId,
        availability: "broken",
      });
    db.prepare("UPDATE workspace SET body=? WHERE id=1").run(
      JSON.stringify(updated),
    );
    return { task: updated.tasks.at(-1) };
  }
  if (action === "shareItem") {
    const v = z
      .object({ itemId: text(100).min(1), shared: z.boolean() })
      .strict()
      .parse(input);
    const i = state.items.find((i) => i.id === v.itemId && i.owner === actor);
    if (!i) throw new AgentError("只能分享自己的物品", 403);
    const old = records<SharedItem>(db, "shareItem").find(
      (r) => r.itemId === i.id && r.owner === actor,
    );
    if (!v.shared) {
      if (old)
        db.prepare("DELETE FROM companion_records WHERE id=? AND owner=?").run(
          old.id,
          actor,
        );
      return { ok: true };
    }
    if (
      i.availability &&
      ["broken", "loaned", "lost", "gifted", "consumed"].includes(
        i.availability,
      )
    )
      throw new AgentError("这件物品目前不能出借");
    put(db, "shareItem", {
      id: old?.id || crypto.randomUUID(),
      owner: actor,
      itemId: i.id,
      name: i.name,
      photo: itemPhoto(i, actor)?.src || "",
      note: "愿意借给朋友使用",
      revision: (old?.revision || 0) + 1,
    });
    return { ok: true };
  }
  if (action === "shareStory") {
    const v = z
      .object({ fragmentId: z.string().uuid(), shared: z.boolean() })
      .strict()
      .parse(input);
    const f = db
      .prepare(
        "SELECT text,revision,created_at FROM life_fragments WHERE id=? AND owner=?",
      )
      .get(v.fragmentId, actor) as
      { text: string; revision: number; created_at: string } | undefined;
    if (!f) throw new AgentError("只能分享自己的故事", 403);
    const old = records<SharedStory>(db, "shareStory").find(
      (r) => r.fragmentId === v.fragmentId && r.owner === actor,
    );
    if (!v.shared) {
      if (old)
        db.prepare("DELETE FROM companion_records WHERE id=? AND owner=?").run(
          old.id,
          actor,
        );
      return { ok: true };
    }
    put(db, "shareStory", {
      id: old?.id || crypto.randomUUID(),
      owner: actor,
      fragmentId: v.fragmentId,
      text: f.text,
      sourceRevision: f.revision,
      at: f.created_at,
      revision: (old?.revision || 0) + 1,
    });
    return { ok: true };
  }
  if (action === "borrow") {
    const { shareId } = z
      .object({ shareId: z.string().uuid() })
      .strict()
      .parse(input);
    const share = records<SharedItem>(db, "shareItem").find(
      (i) => i.id === shareId && i.owner !== actor,
    );
    if (!share) throw new AgentError("物品未公开或不能向自己借用", 403);
    const i = state.items.find(
      (i) => i.id === share.itemId && i.owner === share.owner,
    );
    if (
      !i ||
      ["broken", "loaned", "lost", "gifted", "consumed"].includes(
        i.availability || "",
      )
    )
      throw new AgentError("这件物品目前不可借用");
    const prior = records<Borrow>(db, "borrow").find(
      (b) =>
        b.itemId === i.id &&
        b.owner === actor &&
        ["requested", "approved", "return_requested"].includes(b.status),
    );
    if (prior) return { borrow: prior };
    const b: Borrow = {
      id: crypto.randomUUID(),
      owner: actor,
      recipient: share.owner,
      itemId: i.id,
      itemName: i.name,
      status: "requested",
      revision: 1,
      at: new Date().toISOString(),
    };
    put(db, "borrow", b);
    return { borrow: b };
  }
  if (action === "borrowDecision") {
    const v = z
      .object({
        id: z.string().uuid(),
        revision: z.number().int(),
        decision: z.enum([
          "approve",
          "decline",
          "requestReturn",
          "confirmReturn",
        ]),
      })
      .strict()
      .parse(input);
    const b = records<Borrow>(db, "borrow").find((b) => b.id === v.id);
    if (!b || !([b.owner, b.recipient] as string[]).includes(actor))
      throw new AgentError("记录未获授权", 403);
    if (b.revision !== v.revision)
      throw new AgentError("记录已更新，请刷新", 409);
    const i = state.items.find(
      (i) => i.id === b.itemId && i.owner === b.recipient,
    );
    if (!i) throw new AgentError("物品归属已变化", 409);
    if (v.decision === "approve") {
      if (actor !== b.recipient || b.status !== "requested")
        throw new AgentError("仅所有者可同意借用", 403);
      if (
        ["broken", "loaned", "lost", "gifted", "consumed"].includes(
          i.availability || "",
        )
      )
        throw new AgentError("物品目前不可借用");
      mutate(state, actor, "updateItem", {
        itemId: i.id,
        availability: "loaned",
      });
      b.status = "approved";
    } else if (v.decision === "decline") {
      if (actor !== b.recipient || b.status !== "requested")
        throw new AgentError("当前不能拒绝这条申请", 403);
      b.status = "declined";
    } else if (v.decision === "requestReturn") {
      if (actor !== b.owner || b.status !== "approved")
        throw new AgentError("当前不能申请归还", 403);
      b.status = "return_requested";
    } else {
      if (
        actor !== b.recipient ||
        !["approved", "return_requested"].includes(b.status)
      )
        throw new AgentError("请由所有者确认收到归还", 403);
      mutate(state, actor, "updateItem", {
        itemId: i.id,
        availability: "available",
      });
      b.status = "returned";
    }
    b.revision++;
    put(db, "borrow", b);
    db.prepare("UPDATE workspace SET body=? WHERE id=1").run(
      JSON.stringify(state),
    );
    return { borrow: b };
  }
  if (action === "replacePhoto") {
    const v = z
      .object({ itemId: text(100).min(1), mediaId: z.string().uuid() })
      .strict()
      .parse(input);
    const item = state.items.find(
      (i) => i.id === v.itemId && i.owner === actor,
    );
    if (
      !item ||
      !db
        .prepare("SELECT 1 FROM life_media WHERE id=? AND owner=?")
        .get(v.mediaId, actor)
    )
      throw new AgentError("照片或物品未获授权", 403);
    item.photo = `/api/life/media/${v.mediaId}?actor=${actor}`;
    db.prepare("UPDATE workspace SET body=? WHERE id=1").run(
      JSON.stringify(state),
    );
    return { ok: true };
  }
  if (action === "removeItem") {
    const { itemId } = z.object({ itemId: z.string().max(100) }).parse(input);
    const i = state.items.find((i) => i.id === itemId);
    if (!i || i.owner !== actor)
      throw new AgentError("仅所有者可以移出物品", 403);
    if (
      state.tasks.some(
        (t) => t.itemId === itemId && t.status !== "用户确认完成",
      )
    )
      throw new AgentError("请先处理与物品关联的家庭事项", 409);
    if (
      records<Borrow>(db, "borrow").some(
        (b) =>
          b.itemId === itemId &&
          ["approved", "return_requested"].includes(b.status),
      )
    )
      throw new AgentError("借出中的物品需要先完成归还", 409);
    state.items = state.items.filter((i) => i.id !== itemId);
    for (const share of records<SharedItem>(db, "shareItem").filter(
      (r) => r.itemId === itemId,
    ))
      db.prepare("DELETE FROM companion_records WHERE id=?").run(share.id);
    state.memories = state.memories.filter(
      (m) => m.itemId !== itemId || (m.owner ?? m.author) === actor,
    );
    db.prepare("UPDATE workspace SET body=? WHERE id=1").run(
      JSON.stringify(state),
    );
    return { ok: true };
  }
  if (action === "removeTask") {
    const { taskId } = z.object({ taskId: z.string().max(100) }).parse(input);
    const t = state.tasks.find((t) => t.id === taskId);
    if (
      !t ||
      actor === "friend" ||
      (t.createdBy !== actor && t.assignee !== actor)
    )
      throw new AgentError("仅创建人或负责人可以移除事项", 403);
    if (
      t.itemId &&
      !state.items.some((i) => i.id === t.itemId && canRead(i, actor))
    )
      throw new AgentError("物品未获授权", 403);
    state.tasks = state.tasks.filter((t) => t.id !== taskId);
    db.prepare("UPDATE workspace SET body=? WHERE id=1").run(
      JSON.stringify(state),
    );
    return { ok: true };
  }
  throw new AgentError("不支持的操作");
}
export function seedCompanion(db: DatabaseSync) {
  setup(db);
  if (
    db.prepare("SELECT id FROM companion_records WHERE id='app-seed-v1'").get()
  )
    return;
  const seeds = [
    ["friend", "床头阅读灯", "奶油白 · 暖光，睡前读书用", "desk-lamp"],
    ["friend", "便携蓝牙音箱", "周末在家听听歌", "portable-speaker"],
    ["friend", "一本想读很久的书", "纸质版，慢慢读", "reading-bookcase"],
    ["lin", "一套速写工具", "带着它记录旅行", "sketchbook"],
  ] as const;
  for (const [owner, name, note, img] of seeds) {
    const product =
      process.env.WUJIAN_REAL_CATALOG === "true"
        ? realAppliances.find(
            (p) =>
              p.key ===
              (img === "desk-lamp"
                ? "lamp"
                : img === "portable-speaker"
                  ? "speaker"
                  : ""),
          )
        : undefined;
    put(db, "wish", {
      id: crypto.randomUUID(),
      owner,
      name,
      note,
      photo: product?.photo || `/demo/objects-v1/${img}.webp`,
      url: product?.productUrl || "",
      shared: true,
      revision: 1,
    });
  }
  put(db, "seed", { id: "app-seed-v1", owner: "lin" });
}
