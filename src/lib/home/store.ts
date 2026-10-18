import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import {
  canRead,
  mutate,
  type State,
  type Person,
  type Item,
} from "../domain.ts";
import { AgentError, type ServiceSession } from "../agent/contracts.ts";
import { identity } from "../ai/harness.ts";
import { captureWorkspace } from "../memory/ambient.ts";
import { readSession } from "../repositories/sessions.ts";
import {
  rooms,
  roomFromLocation,
  placeSchema,
  homeActionSchema,
  type Placement,
  type HomeAction,
  type ActionCard,
} from "./contracts.ts";

export const itemStamp = (item: Item) =>
  JSON.stringify([item.owner, identity(item)]);
function accessible(state: State, actor: Person, id: string) {
  const item = state.items.find((i) => i.id === id && canRead(i, actor));
  if (!item) throw new AgentError("物品不存在或未获授权", 403);
  return item;
}
export function placements(
  db: DatabaseSync,
  state: State,
  actor: Person,
): Placement[] {
  const accessibleItems = state.items.filter((i) => canRead(i, actor));
  const counters = new Map<string, number>();
  return accessibleItems.map((item) => {
    const row = db
      .prepare("SELECT * FROM home_placements WHERE item_id=?")
      .get(item.id) as
      | {
          room_id: Placement["roomId"];
          x: number;
          y: number;
          revision: number;
          identity: string;
          location: string;
        }
      | undefined;
    const roomId = roomFromLocation(item.location);
    const n = counters.get(roomId) || 0;
    counters.set(roomId, n + 1);
    const valid =
      row && row.identity === itemStamp(item) && row.location === item.location;
    return {
      itemId: item.id,
      roomId: valid ? row.room_id : roomId,
      x: valid ? row.x : 0.18 + (n % 4) * 0.21,
      y: valid ? row.y : 0.53 + (Math.floor(n / 4) % 2) * 0.25,
      revision: row?.revision || 0,
      saved: !!valid,
    };
  });
}
function placeInTransaction(
  db: DatabaseSync,
  state: State,
  actor: Person,
  value: ReturnType<typeof placeSchema.parse>,
) {
  const item = accessible(state, actor, value.itemId);
  if (item.owner !== actor) throw new AgentError("仅所有者可调整物品位置", 403);
  if (item.location !== value.expectedLocation)
    throw new AgentError("档案位置已更新，请刷新后再调整", 409);
  const old = db
    .prepare("SELECT revision FROM home_placements WHERE item_id=?")
    .get(item.id) as { revision: number } | undefined;
  if ((old?.revision || 0) !== value.expectedRevision)
    throw new AgentError("摆放已更新，请刷新后再调整", 409);
  const room = rooms.find((r) => r.id === value.roomId)!;
  if (roomFromLocation(item.location) !== room.id)
    mutate(state, actor, "updateItem", {
      itemId: item.id,
      location: room.name,
    });
  db.prepare(
    "INSERT INTO home_placements VALUES(?,?,?,?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET room_id=excluded.room_id,x=excluded.x,y=excluded.y,revision=excluded.revision,identity=excluded.identity,location=excluded.location",
  ).run(
    item.id,
    room.id,
    value.x,
    value.y,
    value.expectedRevision + 1,
    itemStamp(item),
    item.location,
  );
  db.prepare("UPDATE workspace SET body=? WHERE id=1").run(
    JSON.stringify(state),
  );
  return {
    itemId: item.id,
    roomId: room.id,
    x: value.x,
    y: value.y,
    revision: value.expectedRevision + 1,
    saved: true,
  } satisfies Placement;
}
export function placeItem(
  db: DatabaseSync,
  read: () => State,
  actor: Person,
  raw: unknown,
) {
  const v = placeSchema.parse(raw);
  const hash = createHash("sha256").update(JSON.stringify(v)).digest("hex");
  db.exec("BEGIN IMMEDIATE");
  try {
    const state = read();
    const item = accessible(state, actor, v.itemId);
    if (item.owner !== actor)
      throw new AgentError("仅所有者可调整物品位置", 403);
    const prior = db
      .prepare(
        "SELECT hash,result FROM home_place_requests WHERE owner=? AND request_id=?",
      )
      .get(actor, v.requestId) as { hash: string; result: string } | undefined;
    if (prior) {
      if (prior.hash !== hash) throw new AgentError("重复请求内容不一致", 409);
      db.exec("COMMIT");
      return JSON.parse(prior.result) as Placement;
    }
    const result = placeInTransaction(db, state, actor, v);
    db.prepare("INSERT INTO home_place_requests VALUES(?,?,?,?)").run(
      actor,
      v.requestId,
      hash,
      JSON.stringify(result),
    );
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function proposeAction(
  db: DatabaseSync,
  state: State,
  actor: Person,
  session: ServiceSession,
  requestId: string,
  raw: HomeAction,
  title: string,
  detail: string[],
): ActionCard {
  const action = homeActionSchema.parse(raw);
  const ids = action.kind === "plan" ? action.itemIds : [action.itemId];
  const identities = Object.fromEntries(
    ids.map((id) => [id, itemStamp(accessible(state, actor, id))]),
  );
  session.itemScopes = { ...session.itemScopes, ...identities };
  const existing = db
    .prepare(
      "SELECT action,card FROM home_proposals WHERE owner=? AND request_id=?",
    )
    .get(actor, requestId) as { action: string; card: string } | undefined;
  if (existing) {
    if (existing.action !== JSON.stringify(action))
      throw new AgentError("本次行动建议已改变，请重新提问", 409);
    return JSON.parse(existing.card);
  }
  const expiresAt = new Date(Date.now() + 15 * 60000).toISOString();
  const card: ActionCard = {
    id: crypto.randomUUID(),
    kind: action.kind,
    title,
    detail,
    status: "pending",
    expiresAt,
    confirmLabel:
      action.kind === "move"
        ? "确认调整位置"
        : action.kind === "plan"
          ? "保存这份计划"
          : "确认交给家人",
  };
  db.prepare("INSERT INTO home_proposals VALUES(?,?,?,?,?,?,?,?,?,NULL)").run(
    card.id,
    actor,
    requestId,
    session.id,
    JSON.stringify(action),
    JSON.stringify(identities),
    JSON.stringify(card),
    "pending",
    expiresAt,
  );
  return card;
}
export function decideAction(
  db: DatabaseSync,
  read: () => State,
  actor: Person,
  id: string,
  decision: "confirm" | "cancel",
) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare("SELECT * FROM home_proposals WHERE id=? AND owner=?")
      .get(id, actor) as
      | {
          action: string;
          identities: string;
          card: string;
          session_id: string;
          expires_at: string;
          status: string;
          result: string | null;
        }
      | undefined;
    if (!row) throw new AgentError("行动建议不存在或未获授权", 403);
    const state = read();
    const session = readSession(db, state, actor, row.session_id);
    const lease = db
      .prepare("SELECT lease_until FROM agent_sessions WHERE id=?")
      .get(session.id) as { lease_until: number };
    if (lease.lease_until > Date.now())
      throw new AgentError("对话正在处理，请稍候再确认", 409);
    const action = homeActionSchema.parse(JSON.parse(row.action));
    for (const [itemId, stamp] of Object.entries(JSON.parse(row.identities)))
      if (itemStamp(accessible(state, actor, itemId)) !== stamp)
        throw new AgentError("物品身份已改变，请重新提出需求", 409);
    if (Date.parse(row.expires_at) <= Date.now())
      throw new AgentError("行动建议已过期，请重新提出需求", 409);
    if (row.status !== "pending") {
      if ((row.status === "applied") !== (decision === "confirm"))
        throw new AgentError("这份建议已经处理", 409);
      db.exec("COMMIT");
      return { ...JSON.parse(row.result || "{}"), session };
    }
    let message = "已取消，没有修改物品或创建事项。";
    if (
      !session.messages.some((m) =>
        m.reply?.actionCards?.some((c) => c.id === id),
      )
    )
      throw new AgentError("行动建议尚未完成，请重新提问", 409);
    let targetId: string | undefined;
    if (decision === "confirm") {
      if (action.kind === "move") {
        placeInTransaction(db, state, actor, {
          ...action,
          requestId: id,
          x: 0.5,
          y: 0.5,
        });
        message = "位置已保存，房间视图和物品档案已更新。";
      } else {
        if (action.kind === "plan") {
          if (
            action.itemIds.some(
              (itemId) =>
                !["在用", "闲置", "待确认"].includes(
                  accessible(state, actor, itemId).state,
                ),
            )
          )
            throw new AgentError("计划中的物品状态已改变，请重新准备", 409);
          if (
            action.itemIds.some(
              (itemId) => accessible(state, actor, itemId).demo,
            )
          )
            throw new AgentError("演示物品不能保存为真实活动资源", 409);
          mutate(state, actor, "savePlan", action);
          targetId = state.plans!.at(-1)!.id;
          message = "计划已保存，可以在活动准备中继续核对和执行。";
        } else {
          mutate(state, actor, "createTask", {
            itemId: action.itemId,
            title: action.summary,
            assignee: action.assignee,
            context: "经本人预览确认的全屋对话摘要；未附上私人故事或整段对话。",
          });
          targetId = state.tasks.at(-1)!.id;
          message = "已创建家庭事项，家人可以在家庭事项中接着处理。";
        }
        db.prepare("UPDATE workspace SET body=? WHERE id=1").run(
          JSON.stringify(state),
        );
        captureWorkspace(db, state, actor);
      }
    }
    const status = decision === "confirm" ? "applied" : "cancelled";
    const result = { id, status, message, targetId };
    const card = { ...JSON.parse(row.card), status };
    db.prepare(
      "UPDATE home_proposals SET status=?,card=?,result=? WHERE id=?",
    ).run(status, JSON.stringify(card), JSON.stringify(result), id);
    for (const m of session.messages)
      for (const c of m.reply?.actionCards || [])
        if (c.id === id) c.status = status;
    session.revision++;
    session.updatedAt = new Date().toISOString();
    session.messages.push({
      id: crypto.randomUUID(),
      role: "action",
      text: message,
      at: session.updatedAt,
      itemId: action.kind === "plan" ? undefined : action.itemId,
    });
    session.messages = session.messages.slice(-30);
    db.prepare("UPDATE agent_sessions SET body=?,revision=? WHERE id=?").run(
      JSON.stringify(session),
      session.revision,
      session.id,
    );
    db.exec("COMMIT");
    return { ...result, session };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
