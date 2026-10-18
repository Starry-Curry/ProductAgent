import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { identity } from "../ai/harness.ts";
import { canRead, seed, type State, type Person } from "../domain.ts";
import type { MemoryRecord, ServiceSession } from "../agent/contracts.ts";
import { isMemoryRecallRequest } from "../skills/memory-storytelling.ts";
const EXTRACTOR = "ambient-local-v1";
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
type Candidate = Pick<MemoryRecord, "kind" | "text"> & {
  topic: string;
  expiresAt?: string;
  polarity?: "positive" | "negative";
};
export type SourceEvent = {
  id: string;
  kind: NonNullable<MemoryRecord["provenance"]>["kind"];
  at: string;
  text: string;
  itemId?: string;
  sessionId?: string;
  basis: NonNullable<MemoryRecord["provenance"]>["basis"];
  candidates?: Candidate[];
};
// This is a narrow local extractor, not unrestricted semantic understanding.
// Skip quoted, hypothetical, third-party and credential-bearing input entirely.
export function safeForMemory(text: string) {
  return !/sk-[a-z0-9_-]{12,}|api[ _-]?key|密钥|密码|身份证|银行卡|1[3-9]\d{9}|\b\d{15,19}\b/i.test(
    text,
  );
}
export function extractChat(
  text: string,
  sessionId?: string,
  at = new Date().toISOString(),
): Candidate[] {
  if (
    !safeForMemory(text) ||
    /^记住[：:，,\s]/u.test(text) ||
    /不要记录|别记|不要记住|不想被记住|假设|如果|例如|比如|示例|测试用|帮我写|编一个|[“”「」"]/u.test(
      text,
    )
  )
    return [];
  const found: Candidate[] = [];
  for (const line of text
    .split(/[，,。；;！!\n]/u)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12)) {
    if (
      line.length > 180 ||
      /[？?]|是不是|是否|喜不喜欢|我朋友|我爸爸|我妈妈|他说|她说/.test(line)
    )
      continue;
    const transient =
      /^(?:我)?(这次|今天|明天|本次|周末)/.test(line) &&
      /想|需要|只用|不要|预算|分钟|小时|准备/.test(line);
    if (
      sessionId &&
      (transient ||
        /^(请|我需要|我希望|我想).*(预算|分钟|只用|不要|需要|简短|详细)/.test(
          line,
        ))
    ) {
      found.push({
        kind: "requirement",
        topic: "session-requirement:" + line,
        text: line,
        expiresAt: new Date(Date.parse(at) + 7 * 86400000).toISOString(),
      });
      continue;
    }
    const interest = line.match(
      /^我(?:平时|一直|很|比较|也|现在)?(不再喜欢|不喜欢|喜欢|爱好是|爱好)(.{1,60})$/u,
    );
    if (interest) {
      const negative = /不/.test(interest[1]);
      const topics = interest[2]
        .replace(/了$/u, "")
        .split(/和|、|以及|还有/u)
        .filter(Boolean)
        .slice(0, 4);
      for (const topic of topics)
        found.push({
          kind: "interest",
          topic: "interest:" + topic,
          text: "我" + (negative ? "不再喜欢" : "喜欢") + topic,
          polarity: negative ? "negative" : "positive",
        });
    } else if (
      /^(以后|我希望|我更喜欢|请).*(简短|详细|一步一步|慢一点)/u.test(line)
    ) {
      found.push({
        kind: "preference",
        topic: "instruction-style",
        text: line,
      });
    } else if (
      /^我(?:刚|已经|之前|上周|昨天|最近)?(?:买了|购买了|买过)/u.test(line)
    ) {
      found.push({
        kind: "purchase",
        topic: "purchase:" + line,
        text: "购买经历（本人聊天陈述，未核验订单）：" + line,
      });
    } else if (
      /^(我|这只|这件|这个|这台).*(送给我|送我的|送的|毕业|一起做|一起买)/u.test(
        line,
      )
    ) {
      found.push({
        kind: "relationship",
        topic: "relationship:" + line,
        text: line,
      });
    }
  }
  return found.slice(0, 8);
}
export function captureSettings(db: DatabaseSync, actor: Person) {
  const at = new Date().toISOString();
  db.prepare(
    "INSERT OR IGNORE INTO memory_capture_settings VALUES (?,1,?,?)",
  ).run(actor, "1970-01-01T00:00:00.000Z", at);
  const row = db
    .prepare(
      "SELECT enabled,since,created_at FROM memory_capture_settings WHERE owner=?",
    )
    .get(actor) as { enabled: number; since: string; created_at: string };
  return {
    enabled: !!row.enabled,
    since: row.since,
    createdAt: row.created_at,
  };
}
export function setCaptureEnabled(
  db: DatabaseSync,
  actor: Person,
  enabled: boolean,
) {
  const current = captureSettings(db, actor);
  if (current.enabled === enabled) return current;
  // Resuming skips historical chat/operation events from the paused interval.
  db.prepare(
    "UPDATE memory_capture_settings SET enabled=?,since=? WHERE owner=?",
  ).run(enabled ? 1 : 0, new Date().toISOString(), actor);
  return captureSettings(db, actor);
}
/** Caller owns the transaction. Receipts contain hashes/locators, never a duplicate raw transcript. */
export function captureEvent(
  db: DatabaseSync,
  state: State,
  actor: Person,
  event: SourceEvent,
) {
  const settings = captureSettings(db, actor);
  const key = event.kind + ":" + event.id;
  const hash = digest(
    JSON.stringify([event.text, event.itemId, event.candidates]),
  );
  const receipt = db
    .prepare(
      "SELECT digest FROM memory_source_receipts WHERE owner=? AND source_key=?",
    )
    .get(actor, key) as { digest: string } | undefined;
  if (receipt?.digest === hash) return [];
  db.prepare(
    "INSERT INTO memory_source_receipts VALUES (?,?,?,?) ON CONFLICT(owner,source_key) DO UPDATE SET digest=excluded.digest,at=excluded.at",
  ).run(actor, key, hash, event.at);
  if (
    !settings.enabled ||
    event.at < settings.since ||
    !safeForMemory(event.text)
  )
    return [];
  const item = event.itemId
    ? state.items.find((i) => i.id === event.itemId && canRead(i, actor))
    : undefined;
  if (event.itemId && !item) return [];
  const candidates =
    event.candidates || extractChat(event.text, event.sessionId, event.at);
  const results: MemoryRecord[] = [];
  for (const candidate of candidates) {
    if (
      !safeForMemory(candidate.text) ||
      !candidate.text.trim() ||
      (candidate.expiresAt && candidate.expiresAt <= new Date().toISOString())
    )
      continue;
    const itemId =
      !item?.demo &&
      ["interest", "preference", "purchase"].includes(candidate.kind)
        ? undefined
        : event.itemId;
    const scope =
      candidate.kind === "requirement" ? event.sessionId : itemId || "global";
    const slot = digest(JSON.stringify([scope, candidate.topic]));
    const link = db
      .prepare(
        "SELECT memory_id,locked FROM memory_capture_slots WHERE owner=? AND slot=?",
      )
      .get(actor, slot) as { memory_id: string; locked: number } | undefined;
    // An explicit correction or forget always wins over passive re-extraction.
    if (link?.locked) continue;
    const prior =
      link &&
      (db
        .prepare(
          "SELECT body,status FROM personal_memories WHERE id=? AND owner=?",
        )
        .get(link.memory_id, actor) as
        { body: string; status: string } | undefined);
    if (prior?.status === "deleted") continue;
    const old = prior ? (JSON.parse(prior.body) as MemoryRecord) : undefined;
    if (old?.provenance && event.at < old.provenance.at) continue;
    const at = new Date().toISOString();
    const memory: MemoryRecord & { itemOwner?: string } = {
      id: old?.id || randomUUID(),
      owner: actor,
      version: (old?.version || 0) + 1,
      kind: candidate.kind,
      text: candidate.text.slice(0, 1500),
      itemId,
      status: "active",
      allowCloud: !item?.demo && (old?.allowCloud || false),
      source: "automatic",
      demo: !!item?.demo,
      expiresAt: candidate.expiresAt,
      polarity: candidate.polarity,
      createdAt: old?.createdAt || at,
      updatedAt: at,
      itemOwner: itemId ? item?.owner : undefined,
      provenance: {
        kind: event.kind,
        sourceId: event.id,
        sessionId: event.sessionId,
        basis: event.basis,
        at: event.at,
        extractor: EXTRACTOR,
      },
    };
    if (old?.text === memory.text && old.polarity === memory.polarity) continue;
    db.prepare(
      "INSERT INTO personal_memories VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,status=excluded.status,version=excluded.version,item_id=excluded.item_id",
    ).run(
      memory.id,
      actor,
      itemId || null,
      JSON.stringify(memory),
      memory.status,
      memory.version,
    );
    db.prepare(
      "INSERT INTO memory_capture_slots VALUES (?,?,?,0) ON CONFLICT(owner,slot) DO UPDATE SET memory_id=excluded.memory_id",
    ).run(actor, slot, memory.id);
    db.prepare("INSERT INTO memory_events VALUES (?,?,?,?,?)").run(
      randomUUID(),
      memory.id,
      actor,
      old ? "auto_revised" : "auto_extracted",
      at,
    );
    results.push(memory);
  }
  // Additions do not revoke access or erase the ongoing conversation. Context is rebuilt each turn.
  return results;
}
export function isStoryNarration(text: string) {
  return (
    text.trim().length >= 4 &&
    safeForMemory(text) &&
    !isMemoryRecallRequest(text) &&
    !/[？?]|什么|有没有|如何|能不能|是否|吗|呢|假设|如果|示例|比如|例如|不要记录|不要记住|别记|编一个|帮我写|想听|想知道|想问|想让你|想请你|希望你|请你|讲一个|讲个|说个/.test(
      text,
    ) &&
    !/^(聊聊|说说|还记得|回忆|你|请|帮我|给我|怎么|为什么|能否|可以)/.test(
      text.trim(),
    )
  );
}
export function captureTurn(
  db: DatabaseSync,
  state: State,
  actor: Person,
  session: ServiceSession,
  requestId: string,
  question: string,
) {
  if (/^记住[：:，,\s]/u.test(question)) return [];
  return captureEvent(db, state, actor, {
    id: requestId,
    kind: "chat",
    at: session.updatedAt,
    text: question,
    itemId: session.itemId,
    sessionId: session.id,
    basis: "user_statement",
    candidates:
      session.mode === "story" &&
      state.items.find((i) => i.id === session.itemId)?.demo &&
      isStoryNarration(question)
        ? [
            {
              kind: "story",
              topic: "demo-narration:" + requestId,
              text: question,
            },
            ...extractChat(question, session.id, session.updatedAt),
          ]
        : session.mode === "story"
          ? extractChat(question, session.id, session.updatedAt).filter(
              (c) => c.kind !== "relationship",
            )
          : undefined,
  });
}
export function captureFeedback(
  db: DatabaseSync,
  state: State,
  actor: Person,
  session: ServiceSession,
  outcome: string,
  reason: string,
) {
  const latest = session.messages.filter((m) => m.role === "assistant").at(-1);
  const steps = latest?.reply?.steps || [];
  // Never merge every attempted suggestion and call the whole history a successful method.
  const text =
    "本次最后一轮建议；我反馈有效（用户报告，非设备检测）：\n" +
    steps.map((s) => s.text).join("\n");
  if (outcome === "completed" && steps.length)
    captureEvent(db, state, actor, {
      id: session.id + ":" + latest!.id,
      kind: "feedback",
      at: session.updatedAt,
      text,
      itemId: session.itemId,
      sessionId: session.id,
      basis: "user_feedback",
      candidates: [{ kind: "method", topic: "method:" + session.id, text }],
    });
  if (outcome === "unresolved") {
    // A later negative result withdraws the derived method, without erasing unrelated chat.
    const rows = db
      .prepare(
        "SELECT id,body FROM personal_memories WHERE owner=? AND status!='deleted'",
      )
      .all(actor) as { id: string; body: string }[];
    for (const row of rows) {
      const m = JSON.parse(row.body) as MemoryRecord;
      if (m.kind === "method" && m.provenance?.sessionId === session.id) {
        db.prepare(
          "UPDATE personal_memories SET body='{}',status='deleted',version=version+1 WHERE id=?",
        ).run(row.id);
        db.prepare(
          "UPDATE memory_capture_slots SET locked=1 WHERE owner=? AND memory_id=?",
        ).run(actor, row.id);
        db.prepare("INSERT INTO memory_events VALUES (?,?,?,?,?)").run(
          randomUUID(),
          row.id,
          actor,
          "feedback_withdrawn",
          new Date().toISOString(),
        );
      }
    }
  }
  if (reason.trim())
    captureEvent(db, state, actor, {
      id: session.id + ":" + session.revision,
      kind: "feedback",
      at: session.updatedAt,
      text: reason,
      itemId: session.itemId,
      sessionId: session.id,
      basis: "user_feedback",
      candidates: [
        {
          kind: "experience",
          topic: "feedback:" + session.id,
          text: "本次使用反馈（本人报告）：" + reason,
          expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        },
      ],
    });
}
/** Reconcile only the actor's own, non-demo records. Also used inside workspace writes. */
export function captureWorkspace(
  db: DatabaseSync,
  state: State,
  actor: Person,
  at?: string,
) {
  const observedAt = at || captureSettings(db, actor).createdAt;
  for (const item of state.items.filter(
    (i) => i.owner === actor && i.source !== "示例数据",
  )) {
    captureEvent(db, state, actor, {
      id: item.id,
      kind: "item",
      at: observedAt,
      text: [item.name, item.model, item.note, item.state].join(" "),
      itemId: item.id,
      basis: "app_record",
      candidates: [
        {
          kind: "possession",
          topic: "possession:" + item.id,
          text:
            "登记持有：" +
            item.name +
            "；型号：" +
            item.model +
            "；状态：" +
            item.state +
            "。来源是本系统登记，未核验实物或订单。",
        },
      ],
    });
    if (item.note)
      captureEvent(db, state, actor, {
        id: item.id + ":note",
        kind: "item",
        at: observedAt,
        text: item.note,
        itemId: item.id,
        basis: "user_statement",
      });
  }
  const demoStoryIds = new Set(seed().memories.map((m) => m.id));
  for (const story of state.memories.filter(
    (m) =>
      m.author === actor && !m.origin && !m.demo && !demoStoryIds.has(m.id),
  ))
    captureEvent(db, state, actor, {
      id: story.id,
      kind: "story",
      at: story.at,
      text: story.text,
      itemId: story.itemId,
      sessionId: story.sourceSessionId,
      basis: "user_statement",
      candidates: [
        { kind: "story", topic: "story:" + story.id, text: story.text },
        ...extractChat(story.text, story.sourceSessionId, story.at).filter(
          (c) => c.kind !== "relationship",
        ),
      ],
    });
  for (const plan of (state.plans || [])
    .filter((p) => p.actor === actor && !p.id.startsWith("demo-plan-"))
    .slice(-30))
    captureEvent(db, state, actor, {
      id: plan.id,
      kind: "task",
      at: plan.at,
      text: plan.goal,
      basis: "app_record",
      candidates: [
        {
          kind: "requirement",
          topic: "plan:" + plan.id,
          text: "活动准备要求：" + plan.goal,
          expiresAt: new Date(Date.parse(plan.at) + 7 * 86400000).toISOString(),
        },
      ],
    });
  for (const task of state.tasks
    .filter((t) => t.createdBy === actor)
    .slice(-30))
    captureEvent(db, state, actor, {
      id: task.id,
      kind: "task",
      at: task.logs[0]?.at || observedAt,
      text: task.title,
      itemId: task.itemId || undefined,
      basis: "app_record",
      candidates: [
        {
          kind: "experience",
          topic: "task:" + task.id,
          text:
            "我创建的家庭事项：" +
            task.title +
            "；" +
            task.status +
            "（事项记录，不代表已购买或实物已修复）",
          expiresAt: new Date(
            Date.parse(task.logs[0]?.at || observedAt) + 30 * 86400000,
          ).toISOString(),
        },
      ],
    });
  for (const attempt of state.attempts
    .filter((a) => a.actor === actor)
    .slice(-30))
    captureEvent(db, state, actor, {
      id: attempt.id,
      kind: "operation",
      at: attempt.at,
      text: attempt.text,
      basis: "observation",
      candidates: [
        {
          kind: "experience",
          topic: "attempt:" + attempt.id,
          text: "尝试记录（不等于喜好）：" + attempt.text,
          expiresAt: new Date(
            Date.parse(attempt.at) + 30 * 86400000,
          ).toISOString(),
        },
      ],
    });
}
export function reconcileMemories(
  db: DatabaseSync,
  state: State,
  actor: Person,
) {
  db.exec("BEGIN IMMEDIATE");
  try {
    captureWorkspace(db, state, actor);
    const sessions = db
      .prepare(
        "SELECT body FROM agent_sessions WHERE owner=? AND expires_at>? ORDER BY rowid DESC LIMIT 25",
      )
      .all(actor, new Date().toISOString()) as { body: string }[];
    for (const row of sessions) {
      const session = JSON.parse(row.body) as ServiceSession;
      if (
        session.status === "closed" ||
        (session.itemId &&
          !state.items.some(
            (i) =>
              i.id === session.itemId &&
              canRead(i, actor) &&
              session.identity === JSON.stringify([i.owner, identity(i)]),
          ))
      )
        continue;
      for (const message of session.messages.filter(
        (m) => m.role === "user" && m.capture !== false,
      ))
        captureEvent(db, state, actor, {
          id: message.id,
          kind: "chat",
          at: message.at,
          text: message.text,
          itemId: message.itemId || session.itemId,
          sessionId: session.id,
          basis: "user_statement",
        });
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
