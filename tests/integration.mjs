import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3101";
async function api(actor, path, body) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { "x-demo-actor": actor, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, data: await r.json() };
}
async function mutate(action, p = {}, actor = "lin") {
  const r = await api(actor, "/api/workspace", { action, ...p });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
const start = Date.now();
let s = await mutate("createItem", { name: "Integration M185 " + Date.now() });
const mouse = s.items.at(-1);
await mutate("bindProduct", {
  itemId: mouse.id,
  packId: "logitech-m185-m-r0061",
  confirmed: true,
});
const ai = await api("lin", "/api/ai", {
  itemId: mouse.id,
  question: "电池规格是什么？",
  mode: "service",
});
assert.equal(ai.status, 503);
assert.equal(ai.data.run.errorCode, "not_configured");
const run = ai.data.run;
const replay = await api("lin", `/api/service-runs?runId=${run.id}&replay=1`);
assert.equal(replay.status, 200);
assert.equal(replay.data.replay.modelCalled, false);
assert.equal(
  (await api("dad", `/api/service-runs?runId=${run.id}&replay=1`)).status,
  403,
);
const origin = await fetch(base + "/api/workspace", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-demo-actor": "lin",
    origin: "https://evil.invalid",
  },
  body: JSON.stringify({ action: "createItem", name: "forbidden" }),
});
assert.equal(origin.status, 400);
s = await mutate("memory", { itemId: mouse.id, text: "original author test" });
const memory = s.memories.at(-1);
s = await mutate("gift", {
  itemId: mouse.id,
  memoryIds: [memory.id],
  message: "integration greeting",
});
const gift = s.gifts.at(-1);
const publicGift = await api("lin", `/api/gift/${gift.token}`);
assert.equal(publicGift.data.storyAuthors[0], "lin");
await mutate("claim", { token: gift.token, received: true }, "friend");
assert.equal(
  (await api("friend", "/api/workspace")).data.memories.find(
    (m) => m.origin?.giftId === gift.id,
  ).author,
  "lin",
);
for (const [name, packId] of [
  ["Speaker", "jbl-go4"],
  ["Cart", "ikea-raskog-30629711"],
]) {
  s = await mutate("createItem", { name: name + " " + Date.now() });
  await mutate("bindProduct", {
    itemId: s.items.at(-1).id,
    packId,
    confirmed: true,
  });
}
const candidates = await api("lin", "/api/discover?scene=outdoor");
assert.ok(candidates.data.candidates.some((c) => c.status === "blocked"));
assert.equal((await api("dad", "/api/discover")).data.candidates.length, 0);
await mutate("setContext", { key: "instructionStyle", value: "short" });
assert.equal((await api("dad", "/api/workspace")).data.contexts.length, 0);
mkdirSync("artifacts", { recursive: true });
const browser = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(base);
  await page.locator(".legacy-home-tools > summary").click();
  await page
    .getByText("已有的帮助设置 · 查看与纠正", { exact: true })
    .waitFor();
  await page.screenshot({ path: "artifacts/desktop.png", fullPage: true });
  await page.getByRole("button", { name: "发现", exact: true }).click();
  await page.getByRole("button", { name: "核对可用组合" }).click();
  await page
    .getByRole("heading", { name: "室内收纳与音乐角", exact: true })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/mobile-discover.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
const report = {
  kind: "local-api-and-browser-no-real-model",
  passed: true,
  elapsedMs: Date.now() - start,
  checks: [
    "missing-model trace",
    "replay authorization",
    "cross-origin write denied",
    "gift original author",
    "dynamic candidate constraints",
    "private Context",
    "desktop/mobile no page errors",
  ],
  realModelCalls: 0,
};
writeFileSync("artifacts/integration.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
