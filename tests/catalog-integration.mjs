/** Optional real public-data test. Never calls a model and never uses the development database. */
import assert from "node:assert/strict";
import fs from "node:fs";
const base = process.env.TEST_BASE_URL;
if (!base) throw Error("isolated TEST_BASE_URL required");
async function api(action, input) {
  const r = await fetch(base + "/api/life", {
    method: "POST",
    headers: { "content-type": "application/json", "x-demo-actor": "lin" },
    body: JSON.stringify({ action, input }),
  });
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  return d;
}
const response = await api("lookupCode", { code: "3017620422003" });
assert.ok(response.candidates.length);
const c = response.candidates[0];
assert.equal(c.trust, "community-metadata");
assert.match(c.license, /ODbL/);
const { item } = await api("createItem", {
  name: c.name,
  brand: c.brand,
  model: c.model,
  category: c.category,
  lifecycle: c.lifecycle,
  availability: "unknown",
  requestId: crypto.randomUUID(),
});
await api("source", { itemId: item.id, ...c.source });
const saved = await (
  await fetch(base + "/api/life?itemId=" + item.id, {
    headers: { "x-demo-actor": "lin" },
  })
).json();
assert.ok(saved.sources.some((s) => s.url === c.source.url));
const result = {
  passed: true,
  realModelCalls: 0,
  source: c.source.url,
  name: c.name,
  license: c.license,
  version: c.version,
  fetchedAt: c.fetchedAt,
  flow: "真实食品条码 -> API候选 -> 人工确认建档 -> 来源保存 -> 详情读取",
  warning: "测试实例是合成持有；众包数据不当作包装事实或营养安全证明",
};
fs.mkdirSync("artifacts/rc", { recursive: true });
fs.writeFileSync(
  "artifacts/rc/catalog-journey.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));
