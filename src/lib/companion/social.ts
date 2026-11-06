import type { DatabaseSync } from "node:sqlite";
import type { Person } from "../domain.ts";
import { AgentError } from "../agent/contracts.ts";
import { z } from "zod";
import { socialProfiles, type Friendship } from "./social-types.ts";
function seed(db: DatabaseSync) {
  const value: Friendship = {
    id: "demo-friend-lin-yu-v1",
    owner: "lin",
    recipient: "friend",
    status: "accepted",
    revision: 1,
    at: "2026-11-06T00:00:00.000Z",
    synthetic: true,
  };
  db.prepare("INSERT OR IGNORE INTO companion_records VALUES(?,?,?,?,?)").run(
    value.id,
    value.owner,
    "friendship",
    JSON.stringify(value),
    1,
  );
}
export function friendships(db: DatabaseSync, actor: Person) {
  seed(db);
  return (
    db
      .prepare(
        "SELECT body FROM companion_records WHERE kind='friendship' ORDER BY rowid DESC",
      )
      .all() as { body: string }[]
  )
    .map((r) => JSON.parse(r.body) as Friendship)
    .filter((r) => r.owner === actor || r.recipient === actor);
}
function put(db: DatabaseSync, value: Friendship) {
  db.prepare(
    "INSERT INTO companion_records VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,revision=excluded.revision",
  ).run(
    value.id,
    value.owner,
    "friendship",
    JSON.stringify(value),
    value.revision,
  );
}
export function socialMutation(
  db: DatabaseSync,
  actor: Person,
  action: string,
  input: unknown,
) {
  if (action === "findFriend" || action === "addFriend") {
    const { code } = z
      .object({ code: z.string().trim().min(1).max(40) })
      .strict()
      .parse(input);
    const profile = socialProfiles.find((p) => p.code === code.toUpperCase());
    if (!profile)
      throw new AgentError(
        "没有找到这个好友编号。当前本机演示可使用 WJ-LIN、WJ-YU、WJ-DAD。",
        404,
      );
    if (profile.id === actor)
      throw new AgentError("这是你自己的编号，请输入朋友的编号");
    const all = friendships(db, actor);
    const old = all.find(
      (r) =>
        (r.owner === profile.id || r.recipient === profile.id) &&
        ["pending", "accepted"].includes(r.status),
    );
    if (action === "findFriend") return { profile, relationship: old || null };
    if (old) return { friendship: old, alreadyExists: true };
    const value: Friendship = {
      id: crypto.randomUUID(),
      owner: actor,
      recipient: profile.id,
      status: "pending",
      revision: 1,
      at: new Date().toISOString(),
    };
    put(db, value);
    return { friendship: value };
  }
  if (action === "friendDecision") {
    const v = z
      .object({
        id: z.string().max(100),
        revision: z.number().int(),
        decision: z.enum(["accept", "decline", "remove"]),
      })
      .strict()
      .parse(input);
    const old = friendships(db, actor).find((r) => r.id === v.id);
    if (!old) throw new AgentError("好友申请不存在或未获授权", 403);
    if (old.revision !== v.revision)
      throw new AgentError("好友状态已变化，请刷新", 409);
    if (v.decision === "accept" || v.decision === "decline") {
      if (old.recipient !== actor || old.status !== "pending")
        throw new AgentError("只有接收人可以处理待通过的申请", 403);
    } else if (
      old.status !== "accepted" &&
      !(old.status === "pending" && old.owner === actor)
    )
      throw new AgentError("当前状态不能移除", 409);
    const value: Friendship = {
      ...old,
      status:
        v.decision === "accept"
          ? "accepted"
          : v.decision === "decline"
            ? "declined"
            : "removed",
      revision: old.revision + 1,
    };
    put(db, value);
    return { friendship: value };
  }
}
