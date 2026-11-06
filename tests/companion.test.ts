import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  companionData,
  mutateCompanion,
  createEventPlan,
  defaultPreferences,
} from "../src/lib/companion/store.ts";
import { seed, type State } from "../src/lib/domain.ts";
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE workspace(id INTEGER PRIMARY KEY,body TEXT);CREATE TABLE life_media(id TEXT PRIMARY KEY,owner TEXT,mime TEXT,body BLOB);",
  );
  const s = seed();
  db.prepare("INSERT INTO workspace VALUES(1,?)").run(JSON.stringify(s));
  return { db, s };
}
const wish = {
  name: "床头灯",
  note: "睡前读书",
  photo: "",
  url: "https://example.com/lamp",
  shared: true,
};
test("wishlist privacy, ownership, edit revision and deletion are enforced", () => {
  const { db, s } = fixture();
  const a = mutateCompanion(db, s, "lin", "wish", wish).wish!;
  assert.equal(companionData(db, "friend").wishes.length, 1);
  assert.throws(
    () =>
      mutateCompanion(db, s, "friend", "wish", {
        ...wish,
        id: a.id,
        revision: 1,
      }),
    /不属于/,
  );
  const b = mutateCompanion(db, s, "lin", "wish", {
    ...wish,
    id: a.id,
    revision: 1,
    shared: false,
  }).wish!;
  assert.equal(companionData(db, "friend").wishes.length, 0);
  assert.throws(
    () =>
      mutateCompanion(db, s, "lin", "deleteWish", { id: b.id, revision: 1 }),
    /已更新/,
  );
  mutateCompanion(db, s, "lin", "deleteWish", { id: b.id, revision: 2 });
  assert.equal(companionData(db, "lin").wishes.length, 0);
  db.close();
});
test("purchase destinations reject script URLs and embedded credentials", () => {
  const { db, s } = fixture();
  for (const bad of [
    "javascript:alert(1)",
    "http://example.com",
    "https://key:secret@example.com",
  ])
    assert.throws(() =>
      mutateCompanion(db, s, "lin", "wish", { ...wish, url: bad }),
    );
  db.close();
});
test("gift note belongs to its writer and never marks a purchase or transfers ownership", () => {
  const { db, s } = fixture();
  const w = mutateCompanion(db, s, "friend", "wish", wish).wish!;
  const g = mutateCompanion(db, s, "lin", "giftNote", {
    wishId: w.id,
    message: "愿你开心",
    paper: "plain",
  }).giftNote!;
  assert.equal(g.recipient, "friend");
  assert.equal(companionData(db, "friend").giftNotes.length, 0);
  assert.equal(s.gifts.length, 0);
  assert.throws(
    () =>
      mutateCompanion(db, s, "friend", "giftNote", {
        wishId: w.id,
        message: "自己",
        paper: "plain",
      }),
    /朋友/,
  );
  db.close();
});
test("activity plans reuse owned practical objects and exclude broken things", () => {
  const { s, db } = fixture();
  s.items.push({
    ...s.items[0],
    id: "blanket",
    name: "野餐垫",
    shared: true,
    availability: "broken",
    state: "损坏",
  });
  s.items.push({ ...s.items[0], id: "private", name: "餐盒", shared: false });
  const p = createEventPlan(s, "lin", "周六4个人野餐");
  assert.equal(p.people, 4);
  assert.equal(p.items.find((i) => i.label === "野餐垫")?.group, "missing");
  assert.equal(p.items.find((i) => i.label === "餐盒")?.group, "owned");
  assert.ok(p.warnings.some((w) => w.includes("野餐垫")));
  db.close();
});
test("checklist changes persist with optimistic concurrency and per-owner scope", () => {
  const { db, s } = fixture();
  const p = mutateCompanion(db, s, "lin", "createPlan", {
    goal: "周末去野餐",
  }).plan!;
  const patch = {
    id: p.id,
    revision: 1,
    title: p.title,
    people: 3,
    items: p.items.map((i, n) => ({ ...i, done: n === 0 })),
  };
  mutateCompanion(db, s, "lin", "updatePlan", patch);
  assert.equal(companionData(db, "lin").plans[0].items[0].done, true);
  assert.equal(companionData(db, "dad").plans.length, 0);
  assert.throws(
    () => mutateCompanion(db, s, "lin", "updatePlan", patch),
    /已更新/,
  );
  db.close();
});
test("checklist cannot bind inaccessible personal objects", () => {
  const { db, s } = fixture();
  const p = mutateCompanion(db, s, "dad", "createPlan", {
    goal: "去野餐",
  }).plan!;
  const item = s.items.find((i) => !i.shared && i.owner === "lin")!;
  assert.throws(
    () =>
      mutateCompanion(db, s, "dad", "updatePlan", {
        ...p,
        items: [{ ...p.items[0], itemId: item.id }],
      }),
    /unrecognized|未获授权/i,
  );
  db.close();
});
test("reminder acknowledgement never repairs a broken item", () => {
  const { db, s } = fixture();
  const item = s.items.find((i) => i.owner === "lin" && i.shared)!;
  const id = crypto.randomUUID();
  mutateCompanion(db, s, "lin", "reportTask", {
    requestId: id,
    title: "先不要用",
    kind: "notice",
    assignee: "dad",
    itemId: item.id,
    stop: false,
  });
  const updated = JSON.parse(
    (db.prepare("SELECT body FROM workspace").get() as any).body,
  ) as State;
  assert.equal(updated.tasks.filter((t) => t.requestId === id).length, 1);
  mutateCompanion(db, updated, "lin", "reportTask", {
    requestId: id,
    title: "先不要用",
    kind: "notice",
    assignee: "dad",
    itemId: item.id,
    stop: false,
  });
  const saved = JSON.parse(
    (db.prepare("SELECT body FROM workspace").get() as any).body,
  ) as State;
  assert.equal(saved.tasks.filter((t) => t.requestId === id).length, 1);
  db.close();
});
test("photo replacement requires both media and object ownership", () => {
  const { db, s } = fixture();
  const item = s.items.find((i) => i.owner === "lin")!;
  const mediaId = crypto.randomUUID();
  db.prepare("INSERT INTO life_media VALUES(?,?,?,?)").run(
    mediaId,
    "dad",
    "image/jpeg",
    new Uint8Array([1]),
  );
  assert.throws(
    () =>
      mutateCompanion(db, s, "lin", "replacePhoto", {
        itemId: item.id,
        mediaId,
      }),
    /未获授权/,
  );
  db.close();
});
test("companion identity is persisted per person", () => {
  const { db, s } = fixture();
  mutateCompanion(db, s, "lin", "preferences", {
    ...defaultPreferences,
    name: "阿圆圆",
    onboarded: true,
  });
  assert.equal(companionData(db, "lin").preferences.name, "阿圆圆");
  assert.equal(companionData(db, "dad").preferences.name, "阿圆");
  db.close();
});
test("public item sharing and borrowing require explicit owner decisions", () => {
  const { db, s } = fixture();
  const item = s.items.find((i) => i.owner === "lin")!;
  mutateCompanion(db, s, "lin", "shareItem", { itemId: item.id, shared: true });
  const share = companionData(db, "friend").sharedItems[0];
  assert.ok(share);
  const b = mutateCompanion(db, s, "friend", "borrow", {
    shareId: share.id,
  }).borrow!;
  assert.equal(b.status, "requested");
  assert.throws(
    () =>
      mutateCompanion(db, s, "friend", "borrowDecision", {
        id: b.id,
        revision: 1,
        decision: "approve",
      }),
    /所有者/,
  );
  mutateCompanion(db, s, "lin", "borrowDecision", {
    id: b.id,
    revision: 1,
    decision: "approve",
  });
  assert.equal(s.items.find((i) => i.id === item.id)?.availability, "loaned");
  assert.throws(
    () => mutateCompanion(db, s, "lin", "removeItem", { itemId: item.id }),
    /归还/,
  );
  const r = mutateCompanion(db, s, "friend", "borrowDecision", {
    id: b.id,
    revision: 2,
    decision: "requestReturn",
  }).borrow!;
  assert.equal(s.items.find((i) => i.id === item.id)?.availability, "loaned");
  mutateCompanion(db, s, "lin", "borrowDecision", {
    id: b.id,
    revision: r.revision,
    decision: "confirmReturn",
  });
  assert.equal(
    s.items.find((i) => i.id === item.id)?.availability,
    "available",
  );
  db.close();
});
test("private media cannot be added to someone else’s wishlist", () => {
  const { db, s } = fixture();
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO life_media VALUES(?,?,?,?)").run(
    id,
    "dad",
    "image/jpeg",
    new Uint8Array([1]),
  );
  assert.throws(
    () =>
      mutateCompanion(db, s, "lin", "wish", {
        ...wish,
        photo: "/api/life/media/" + id + "?actor=dad",
      }),
    /未获授权/,
  );
  db.close();
});
test("sharing can be revoked without deleting the item", () => {
  const { db, s } = fixture();
  const i = s.items.find((i) => i.owner === "lin")!;
  mutateCompanion(db, s, "lin", "shareItem", { itemId: i.id, shared: true });
  mutateCompanion(db, s, "lin", "shareItem", { itemId: i.id, shared: false });
  assert.equal(companionData(db, "friend").sharedItems.length, 0);
  assert.ok(s.items.find((x) => x.id === i.id));
  db.close();
});
test("confirmed legacy conversation plans appear in the new checklist and do not resurrect after deletion", () => {
  const { db, s } = fixture();
  const id = crypto.randomUUID();
  s.plans = [
    {
      id,
      actor: "lin",
      goal: "周六出门准备",
      itemIds: [],
      at: new Date().toISOString(),
      checklist: [{ label: "带上水杯", status: "待准备" }],
    },
  ];
  db.prepare("UPDATE workspace SET body=?").run(JSON.stringify(s));
  let p = companionData(db, "lin").plans.find((p) => p.id === id)!;
  assert.equal(p.source, "assistant-plan");
  assert.equal(p.items[0].label, "带上水杯");
  p = mutateCompanion(db, s, "lin", "updatePlan", {
    id,
    revision: p.revision,
    title: p.title,
    people: p.people,
    items: p.items.map((i) => ({ ...i, done: true })),
  }).plan!;
  assert.equal(s.plans[0].checklist![0].status, "已完成");
  mutateCompanion(db, s, "lin", "deletePlan", { id, revision: p.revision });
  assert.equal(companionData(db, "lin").plans.length, 0);
  db.close();
});
