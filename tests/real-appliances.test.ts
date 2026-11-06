import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { seed, mutate, type Item } from "../src/lib/domain.ts";
import {
  realAppliances,
  bindReferenceAppliance,
  referenceAppliance,
} from "../src/lib/catalog/real-appliances.ts";
import {
  upgradeReferenceFixtures,
  installReferenceFixtures,
} from "../src/lib/catalog/install-real-appliances.ts";
import { referenceManual } from "../src/lib/life/reference-manuals.ts";
import {
  readKnowledge,
  retrieveKnowledge,
  acquireKnowledge,
} from "../src/lib/life/acquisition.ts";
import { itemPhoto } from "../src/lib/life/item-photos.ts";
function item(id: string) {
  return bindReferenceAppliance(
    { ...seed().items[0], id: "device-" + id, synthetic: true, shared: false },
    id,
  );
}
test("all nine real devices have readable, exact-identity official manuals and real photographs", () => {
  assert.equal(realAppliances.length, 9);
  for (const p of realAppliances) {
    const i = item(p.id);
    const d = referenceManual(i);
    assert.ok(d, p.id);
    assert.ok(d.text.length > 1500, p.id);
    assert.ok(d.text.includes("PDF page"), p.id);
    assert.ok(fs.statSync("public" + p.photo).size > 1000);
    assert.equal(itemPhoto(i, "lin")?.generated, false);
    assert.equal(itemPhoto(i, "lin")?.src, p.photo);
  }
});
test("registered manual reuse needs no network, preserves source metadata and respects private-item access", async () => {
  const db = new DatabaseSync(":memory:");
  const s = seed();
  s.items = [item("mi-lamp-1s-tw")];
  let fetches = 0;
  const d = await acquireKnowledge(db, () => s, "lin", s.items[0].id, {
    fetchDocument: async () => {
      fetches++;
      throw Error("network must not run");
    },
  });
  assert.equal(fetches, 0);
  assert.equal(d.cached, true);
  assert.ok(d.documents.length >= 1);
  assert.match(d.documents[0].url, /mi-fds.com/);
  assert.equal(readKnowledge(db, s, "friend", s.items[0].id).length, 0);
  await assert.rejects(
    acquireKnowledge(db, () => s, "friend", s.items[0].id),
    /授权/,
  );
  db.close();
});
test("changing brand, model or region invalidates the pinned manual and original product picture", () => {
  const s = seed();
  s.items = [item("mi-lamp-1s-tw")];
  const i = s.items[0];
  const changed = mutate(s, "lin", "updateItem", {
    itemId: i.id,
    model: "another lamp",
  }).items[0];
  assert.equal(referenceAppliance(changed), undefined);
  assert.equal(referenceManual(changed), undefined);
  assert.equal(changed.referenceProductId, undefined);
  assert.equal(changed.photo, undefined);
  const other = { ...i, region: "cn" };
  assert.equal(referenceManual(other), undefined);
});
test("a model selection is owner-authorized; random IDs cannot become document paths", () => {
  const s = seed();
  assert.throws(
    () =>
      mutate(s, "friend", "updateItem", {
        itemId: "lamp",
        referenceProductId: "mi-lamp-1s-tw",
      }),
    /所有者|授权/,
  );
  assert.throws(
    () =>
      mutate(s, "lin", "updateItem", {
        itemId: "lamp",
        referenceProductId: "../../.env.local",
      }),
    /没有这款/,
  );
  const changed = mutate(s, "lin", "updateItem", {
    itemId: "lamp",
    referenceProductId: "mi-lamp-1s-tw",
  }).items.find((i) => i.id === "lamp")!;
  assert.equal(changed.model, "MJTD01SYL");
  assert.equal(changed.brand, "小米");
  assert.ok(referenceManual(changed));
});
test("fixture upgrade only changes known synthetic examples and preserves user uploads and other objects", () => {
  const s = seed();
  const user = {
    ...s.items[0],
    id: "user-lamp",
    source: "我的物品",
    synthetic: false,
    model: "My model",
  };
  s.items.push(user);
  const untouched = { ...s.items[0], photo: "/api/life/media/my-photo" };
  s.items[0] = untouched;
  upgradeReferenceFixtures(s);
  assert.equal(s.items[0].referenceProductId, undefined);
  assert.equal(user.model, "My model");
  assert.equal(s.items.find((i) => i.id === "filter")?.model, "ADD6910");
  assert.equal(s.items.find((i) => i.id === "frame")?.model, "无品牌");
});
test("lamp controls, kettle care, vacuum charging and speaker pairing are actually retrievable", () => {
  const db = new DatabaseSync(":memory:");
  const s = seed();
  s.items = realAppliances.map((p) => item(p.id));
  for (const [id, q, expected] of [
    ["mi-lamp-1s-tw", "如何调节亮度？", /旋鈕|旋钮/],
    ["xiaomi-kettle2-uk", "怎么清洁？", /vinegar|clean/i],
    ["xiaomi-g20lite-uk", "怎么充电？", /充電|charg/i],
    ["jbl-go4-global", "怎么配对蓝牙？", /Bluetooth|蓝牙/i],
  ] as [string, string, RegExp][]) {
    const chunks = retrieveKnowledge(db, s, "lin", "device-" + id, q);
    assert.ok(
      chunks.some((c) => expected.test(c.text)),
      id,
    );
  }
  db.close();
});

test("reviewed manual fallback is labelled, topic-limited and advances only explicitly tried steps", async () => {
  const { reviewedReferenceGuidance } =
    await import("../src/lib/life/reference-manuals.ts");
  const kettle = item("xiaomi-kettle2-uk");
  const first = reviewedReferenceGuidance(
    kettle,
    "第一次怎么用这个水壶烧水？",
    [],
    true,
  )!;
  assert.equal(first.source, "curated-guidance");
  assert.match(first.citations[0].title, /中文转述/);
  assert.equal(first.steps.length, 3);
  const second = reviewedReferenceGuidance(
    kettle,
    "第一次怎么用这个水壶烧水？",
    first.steps.map((s) => s.id),
    true,
  )!;
  assert.ok(
    second.steps.every((s) => !first.steps.some((old) => old.id === s.id)),
  );
  assert.equal(
    reviewedReferenceGuidance(kettle, "怎么带电拆开维修？"),
    undefined,
  );
  assert.equal(
    reviewedReferenceGuidance(kettle, "这个壶能设置预约吗？"),
    undefined,
  );
});
test("PDF escape whitespace and typographic quote differences do not license changed numbers", async () => {
  const { quoteInSource } = await import("../src/lib/skills/document-help.ts");
  assert.equal(
    quoteInSource(
      "點擊“\t”童鎖鍵，按住 7 秒。",
      String.raw`點擊"\t"童鎖鍵，按住 7 秒。`,
    ),
    true,
  );
  assert.equal(quoteInSource("按住 7 秒。", "按住 9 秒。"), false);
});
