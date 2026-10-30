import type { DatabaseSync } from "node:sqlite";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { mutate, visible, canRead, type State, type Person } from "./domain.ts";
import { AgentError } from "./agent/contracts.ts";
import { accountDB } from "./accounts.ts";
import { migrateUnified } from "./foundation/schema.ts";
import { mirrorItemGrant } from "./foundation/policy.ts";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const at = () => new Date().toISOString();
function schema(db: DatabaseSync) {
  migrateUnified(db);
  db.exec(`CREATE TABLE IF NOT EXISTS household_members(group_id TEXT NOT NULL,account_id TEXT NOT NULL,PRIMARY KEY(group_id,account_id));
    CREATE TABLE IF NOT EXISTS household_invites(hash TEXT PRIMARY KEY,group_id TEXT NOT NULL,inviter TEXT NOT NULL,expires INTEGER NOT NULL,claimed_by TEXT);
    CREATE TABLE IF NOT EXISTS collaboration_receipts(actor TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(actor,id));`);
}
export function householdMembers(db: DatabaseSync, actor: Person) {
  schema(db);
  const rows = db
    .prepare(
      `SELECT DISTINCT b.account_id AS id FROM household_members a JOIN household_members b ON a.group_id=b.group_id WHERE a.account_id=?`,
    )
    .all(actor) as { id: Person }[];
  return rows.map((r) => ({
    id: r.id,
    name:
      (
        accountDB()
          .prepare("SELECT name FROM accounts WHERE id=?")
          .get(r.id) as { name: string } | undefined
      )?.name || "家庭成员",
  }));
}
export function collaborate(
  db: DatabaseSync,
  read: () => State,
  actor: Person,
  raw: unknown,
) {
  if (!actor.startsWith("u_"))
    throw new AgentError("请使用独立账号进行真实成员协作", 403);
  schema(db);
  const v = z
    .object({
      requestId: z.string().uuid(),
      action: z.enum([
        "invite",
        "join",
        "share",
        "task",
        "seen",
        "accept",
        "report_done",
        "unresolved",
      ]),
      token: z.string().max(64).optional(),
      itemId: z.string().max(100).optional(),
      memberId: z.string().max(100).optional(),
      title: z.string().trim().max(120).optional(),
      summary: z.string().trim().max(1200).optional(),
      taskId: z.string().max(100).optional(),
      confirmed: z.boolean().optional(),
      enabled: z.boolean().optional(),
    })
    .strict()
    .parse(raw);
  db.exec("BEGIN IMMEDIATE");
  try {
    const payload = JSON.stringify(v),
      prior = db
        .prepare(
          "SELECT payload,result FROM collaboration_receipts WHERE actor=? AND id=?",
        )
        .get(actor, v.requestId) as
        { payload: string; result: string } | undefined;
    if (prior) {
      if (prior.payload !== payload)
        throw new AgentError("重复请求的内容已变化", 409);
      db.exec("COMMIT");
      return JSON.parse(prior.result);
    }
    let state = read(),
      result: Record<string, unknown> = {};
    if (v.action === "invite") {
      if (!v.confirmed) throw new AgentError("请确认创建家庭邀请");
      const group =
        (
          db
            .prepare(
              "SELECT group_id FROM household_members WHERE account_id=? LIMIT 1",
            )
            .get(actor) as { group_id: string } | undefined
        )?.group_id || crypto.randomUUID();
      db.prepare("INSERT OR IGNORE INTO household_members VALUES(?,?)").run(
        group,
        actor,
      );
      const token = randomBytes(24).toString("hex");
      db.prepare("INSERT INTO household_invites VALUES(?,?,?,?,NULL)").run(
        hash(token),
        group,
        actor,
        Date.now() + 86400000,
      );
      result = {
        invite: token,
        notice: "邀请24小时有效；仅建立成员关系，不自动共享任何物品或故事。",
      };
    } else if (v.action === "join") {
      if (!v.confirmed || !v.token)
        throw new AgentError("请确认加入邀请中的家庭");
      const invite = db
        .prepare(
          "SELECT * FROM household_invites WHERE hash=? AND expires>? AND claimed_by IS NULL",
        )
        .get(hash(v.token), Date.now()) as
        { group_id: string; inviter: string } | undefined;
      if (!invite || invite.inviter === actor)
        throw new AgentError("邀请已失效或不能自己接受", 409);
      db.prepare("INSERT OR IGNORE INTO household_members VALUES(?,?)").run(
        invite.group_id,
        actor,
      );
      db.prepare("UPDATE household_invites SET claimed_by=? WHERE hash=?").run(
        actor,
        hash(v.token),
      );
      result = { joined: true };
    } else if (v.action === "share") {
      const item = state.items.find(
        (i) => i.id === v.itemId && i.owner === actor,
      );
      if (
        !item ||
        !v.memberId ||
        !householdMembers(db, actor).some((m) => m.id === v.memberId)
      )
        throw new AgentError("仅能将自己的物品授权给已加入的家庭成员", 403);
      item.sharedWith = [
        ...new Set(
          (item.sharedWith || [])
            .filter((id) => id !== v.memberId)
            .concat(v.enabled ? [v.memberId as Person] : []),
        ),
      ];
      item.shared = item.sharedWith.length > 0;
      mirrorItemGrant(db, state, actor, v.memberId as Person, item.id, !!v.enabled);
      result = {
        shared: item.shared,
        notice:
          "共享物品档案与服务器核对的厂家公开资料；未共享私人上传资料、私聊、故事、人格和个人记忆。",
      };
    } else if (v.action === "task") {
      if (!v.confirmed || !v.title || !v.summary)
        throw new AgentError("先核对家人将看到的求助摘要并确认");
      state = mutate(state, actor, "createTask", {
        itemId: v.itemId,
        assignee: v.memberId,
        title: v.title,
        context: v.summary,
      });
      result = {
        taskId: state.tasks.at(-1)!.id,
        notice: "事项已创建；对方尚未读取，未发送短信或外部通知。",
      };
    } else {
      const task = state.tasks.find(
        (t) => t.id === v.taskId && t.assignee === actor,
      );
      const item = state.items.find(
        (i) => i.id === task?.itemId && canRead(i, actor),
      );
      if (!task || !item || !item.shared)
        throw new AgentError("任务或物品未获授权", 403);
      if (v.action === "seen") { task.seenAt ||= at(); if (task.kind === "notice") task.acknowledged = true; }
      else if (v.action === "accept") {
        if (task.reportedAt)
          throw new AgentError(
            "该事项已报告完成；需要再处理时请先标记仍未解决",
            409,
          );
        task.seenAt ||= at();
        task.acceptedAt ||= at();
        task.status = "进行中";
      } else {
        if (!task.acceptedAt || !v.confirmed)
          throw new AgentError("请先接手，再确认报告结果");
        task.status = v.action === "report_done" ? "用户确认完成" : "未解决";
        if (v.action === "report_done") {
          task.reportedAt = at();
          task.completionBasis = "user_report";
        } else {
          delete task.reportedAt;
          delete task.completionBasis;
        }
      }
      task.logs.push({ by: actor, text: v.summary || v.action, at: at() });
      result = {
        taskId: task.id,
        status: task.status,
        completionBasis: task.completionBasis || null,
      };
    }
    db.prepare("UPDATE workspace SET body=? WHERE id=1").run(
      JSON.stringify(state),
    );
    db.prepare("INSERT INTO collaboration_receipts VALUES(?,?,?,?)").run(
      actor,
      v.requestId,
      payload,
      JSON.stringify(result),
    );
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
