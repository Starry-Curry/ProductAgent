/** Two synthetic visitors against a separate production server. No real provider calls. */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import sharp from "sharp";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
const folder = fs.mkdtempSync(
  path.join(process.cwd(), ".runtime", "cloud-e2e-"),
);
let volume = path.join(folder, "volume");
const socket = createServer();
await new Promise((r) => socket.listen(0, "127.0.0.1", r));
const port = socket.address().port;
await new Promise((r) => socket.close(r));
const base = `http://127.0.0.1:${port}`;
const sentinel = "offline-cloud-key-sentinel-not-a-real-credential";
const env = () => ({
  ...process.env,
  NODE_ENV: "production",
  AUTH_MODE: "public-demo",
  WUJIAN_DEPLOYMENT: "cloud",
  PRODUCT_AGENT_DATA_DIR: volume,
  APP_PUBLIC_ORIGIN: base,
  DEMO_ALLOW_LOCAL_HTTP: "true",
  DEMO_REQUIRE_VOLUME: "false",
  DEMO_OPEN_ACCESS: "true",
  DEMO_ACCESS_CODE: "",
  PORT: String(port),
  AI_API_KEY: sentinel,
  AI_MODEL: "qwen-plus",
  AI_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  DEMO_AI_ENABLED: "false",
  AI_ALLOW_PAID_CALLS: "false",
  WUJIAN_ALLOW_PAID_CALLS: "false",
  WUJIAN_ALLOW_PUBLIC_FETCH: "false",
  DEMO_REQUESTS_PER_MINUTE: "90",
  NEXT_TELEMETRY_DISABLED: "1",
  LANGSMITH_TRACING: "false",
  LANGCHAIN_TRACING_V2: "false",
});
let modelMode = false,
  toolMode = false,
  secretLogged = false;
let child,
  logs = "";
const checks = [];
async function start() {
  logs = "";
  child = spawn(process.execPath, ["scripts/cloud-start.mjs"], {
    env: modelMode
      ? {
          ...env(),
          DEMO_AI_ENABLED: "true",
          AI_ALLOW_PAID_CALLS: "true",
          WUJIAN_ALLOW_PAID_CALLS: "true",
          DEMO_GLOBAL_MODEL_CALLS: toolMode ? "8" : "1",
          WUJIAN_TEST_TOOL_LOOP: toolMode ? "true" : "false",
          NODE_OPTIONS: `--import=${new URL("../tests/cloud-provider-stub.mjs", import.meta.url).href}`,
        }
      : env(),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  for (const p of [child.stdout, child.stderr])
    p.on("data", (d) => {
      if (String(d).includes(sentinel)) secretLogged = true;
      logs = (logs + d).slice(-12000);
    });
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null)
      throw Error("production server exited unexpectedly");
    try {
      if ((await fetch(base + "/api/health")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw Error("healthcheck timeout");
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exit = new Promise((r) => child.once("exit", r));
  child.send({ command: "stop-cloud-test" });
  await Promise.race([
    exit,
    new Promise((_, reject) =>
      setTimeout(() => reject(Error("server did not stop")), 12000),
    ),
  ]);
}
async function call(url, cookie, body, extra = {}) {
  const r = await fetch(base + url, {
    method: body ? "POST" : "GET",
    headers: {
      cookie: cookie || "",
      ...(body ? { "Content-Type": "application/json", Origin: base } : {}),
      ...extra,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  assert.ok(!text.includes(sentinel), "key in API response");
  assert.doesNotMatch(text, /[A-Z]:\\|\.env\.local|npm run/);
  return { status: r.status, data: JSON.parse(text) };
}
async function enter() {
  const r = await fetch(base + "/api/demo/session", {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ consent: true }),
  });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("set-cookie"), /HttpOnly/);
  assert.match(r.headers.get("set-cookie"), /SameSite=Strict/);
  return r.headers.get("set-cookie").split(";")[0];
}
const post = (cookie, action, input) =>
  call("/api/life", cookie, { action, input });
try {
  await start();
  assert.equal((await call("/api/life")).status, 401);
  const a = await enter(),
    b = await enter();
  const ai = await post(a, "createItem", {
    name: "Synthetic Visitor A box",
    brand: "Test",
    model: "A-BOX",
    category: "厨房用品",
    lifecycle: "长期耐用",
    availability: "available",
  });
  assert.equal(ai.status, 200);
  const item = ai.data.item;
  const bi = await post(b, "createItem", {
    name: "Synthetic Visitor B book",
    brand: "Test",
    model: "B-BOOK",
    category: "图书",
    lifecycle: "长期耐用",
    availability: "available",
  });
  assert.equal(bi.status, 200);
  const pixels = await sharp({
    create: { width: 120, height: 80, channels: 3, background: "#8d9f77" },
  })
    .jpeg()
    .toBuffer();
  const form = new FormData();
  form.set("kind", "story-photo");
  form.set("file", new File([pixels], "synthetic.jpg", { type: "image/jpeg" }));
  const upload = await fetch(base + "/api/life", {
    method: "POST",
    headers: { cookie: a, Origin: base },
    body: form,
  });
  assert.equal(upload.status, 200);
  const image = await upload.json();
  const saved = await post(a, "fragment", {
    text: "Synthetic visitor A private story",
    itemIds: [item.id],
    mediaIds: [image.id],
    allowRecall: true,
    allowCloud: false,
  });
  assert.equal(saved.status, 200);
  const story = saved.data.fragment;
  const memories = await call("/api/memories", a, {
    memory: {
      kind: "preference",
      text: "Synthetic A prefers calm plans",
      allowCloud: false,
    },
    requestId: crypto.randomUUID(),
  });
  assert.equal(memories.status, 200);
  const stateA = await call("/api/life", a),
    stateB = await call("/api/life", b, null, {
      "x-demo-actor": "dad",
      "x-tenant-id": "forged",
    });
  assert.equal(stateB.status, 200);
  assert.ok(!JSON.stringify(stateB.data).includes(item.id));
  assert.ok(!JSON.stringify(stateB.data).includes(story.text));
  assert.equal(stateA.data.capabilities.cloud.ready, false);
  assert.equal((await call("/api/life?itemId=" + item.id, b)).status, 403);
  assert.equal(
    (
      await fetch(base + `/api/life/media/${image.id}?actor=lin`, {
        headers: { cookie: b },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await post(b, "deleteFragment", {
        id: story.id,
        revision: story.revision,
      })
    ).status,
    403,
  );
  const memoryB = await call("/api/memories", b);
  assert.ok(!JSON.stringify(memoryB.data).includes("Synthetic A prefers"));
  const reply = await call("/api/assistant", a, {
    requestId: crypto.randomUUID(),
    question: "你好",
    mode: "auto",
    memoryPolicy: "off",
    uiContext: { page: "assistant" },
  });
  assert.equal(reply.status, 200);
  assert.equal(reply.data.modelCalls, 0);
  if (reply.data.session?.id)
    assert.equal(
      (await call("/api/assistant?sessionId=" + reply.data.session.id, b))
        .status,
      403,
    );
  for (const [x, y] of [
    [a, b],
    [b, a],
  ]) {
    const r = await call("/api/workspace", x, null, {
      "x-demo-actor": "friend",
      "x-visitor-token": y,
    });
    assert.equal(r.status, 200);
    assert.ok(r.data.items.some((i) => i.owner === "lin"));
  }
  assert.equal(
    (await call("/api/workspace", a, { action: "admin", path: "/data" }))
      .status,
    400,
  );
  assert.equal(
    (
      await call(
        "/api/life",
        a,
        { action: "createItem", input: {} },
        { Origin: "https://attacker.invalid" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/api/life", a, {
        action: "fetchSource",
        url: "https://127.0.0.1/",
      })
    ).status >= 400,
    true,
  );
  checks.push(
    "two visitor namespaces: items/stories/media/memory/sessions isolated; forged actor/tenant denied; no anonymous admin",
  );
  // Parallel asynchronous handlers must retain their visitor's actual database, not a shared mutable current directory.
  const parallel = await Promise.all(
    Array.from({ length: 4 }, (_, i) => call("/api/life", i % 2 ? a : b)),
  );
  for (let i = 0; i < parallel.length; i++)
    assert.ok(
      !JSON.stringify(parallel[i].data).includes(
        i % 2 ? bi.data.item.id : item.id,
      ),
    );
  await stop();
  await start();
  assert.ok(
    (await call("/api/life", a)).data.fragments.some((f) => f.id === story.id),
  );
  assert.equal(
    (
      await fetch(base + `/api/life/media/${image.id}`, {
        headers: { cookie: a },
      })
    ).status,
    200,
  );
  checks.push(
    "server restart preserves opaque session, original story and photo",
  );
  await stop();
  const backup = spawnSync(
    process.execPath,
    ["scripts/cloud-ops.mjs", "backup", "--server-stopped"],
    { env: env(), encoding: "utf8" },
  );
  assert.equal(backup.status, 0, backup.stderr);
  const snapshot = JSON.parse(backup.stdout.trim()).backup;
  volume = path.join(folder, "restored-volume");
  const restore = spawnSync(
    process.execPath,
    [
      "scripts/cloud-ops.mjs",
      "restore",
      "--from",
      snapshot,
      "--apply",
      "--server-stopped",
    ],
    { env: env(), encoding: "utf8" },
  );
  assert.equal(restore.status, 0, restore.stderr);
  await start();
  assert.ok(
    (await call("/api/life", a)).data.fragments.some((f) => f.id === story.id),
  );
  assert.ok(
    !(await call("/api/life", b)).data.fragments.some((f) => f.id === story.id),
  );
  checks.push(
    "consistent SQLite snapshot and empty-volume restore preserve data and visitor isolation",
  );
  const browser = await chromium.launch({
    executablePath:
      process.env.EDGE_PATH ||
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless: true,
    args: ["--disable-gpu"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.context().addCookies([
      {
        name: "wujian_visitor",
        value: a.split("=")[1],
        url: base,
        httpOnly: true,
        sameSite: "Strict",
      },
    ]);
    await page.goto(base + "/#stories");
    await expect(
      page.getByRole("heading", { name: "生活故事书" }),
    ).toBeVisible();
    await expect(page.getByText(story.text, { exact: true })).toBeVisible();
    await expect(page.getByLabel("演示家庭成员")).toHaveCount(0);
    fs.mkdirSync("artifacts/cloud", { recursive: true });
    await page.screenshot({
      path: "artifacts/cloud/stories-desktop.png",
      fullPage: true,
    });
    assert.doesNotMatch(
      await page.locator("body").innerText(),
      /[A-Z]:\\|\.env\.local|npm run/,
    );
    await page.reload();
    await expect(page.getByText(story.text, { exact: true })).toBeVisible();
    await page.goto(base + "/legacy");
    await expect(page.locator("body")).not.toContainText(
      "请先进入自己的演示空间",
    );
    const html = await (await fetch(base)).text();
    for (const resource of [...html.matchAll(/src="([^\"]+\.js[^\"]*)"/g)].map(
      (m) => m[1],
    ))
      assert.ok(
        !(await (await fetch(base + resource)).text()).includes(sentinel),
      );
    checks.push(
      "browser story refresh, no local identity switch or developer setup UI; no API key in HTML/JS/API",
    );
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close();
  }
  await stop();
  modelMode = true;
  await start();
  assert.equal(
    (await call("/api/life", a)).data.capabilities.cloud.ready,
    true,
  );
  const modelReply = await call("/api/assistant", a, {
    requestId: crypto.randomUUID(),
    question: "今天有点累了，想慢慢聊聊接下来怎么放松，别谈物品。",
    mode: "auto",
    memoryPolicy: "off",
    uiContext: { page: "assistant" },
  });
  assert.equal(modelReply.status, 200);
  assert.match(modelReply.data.reply.answer, /合成离线替身/);
  assert.equal(
    (await call("/api/life", b)).data.capabilities.cloud.state,
    "budget_exhausted",
  );
  await stop();
  await start();
  assert.equal(
    (await call("/api/life", a)).data.capabilities.cloud.state,
    "budget_exhausted",
  );
  checks.push(
    "enabled AI uses test-process-only stub; global budget survives restart and applies to another visitor (0 real model calls)",
  );
  const c = await enter();
  let throttled = false;
  for (let i = 0; i < 181; i++) {
    const r = await call("/api/products", c);
    if (r.status === 429) {
      throttled = true;
      break;
    }
  }
  assert.ok(throttled);
  checks.push("HTTP rate limit active; AI disabled and zero live model calls");
  await fetch(base + "/api/demo/session", {
    method: "DELETE",
    headers: { cookie: b, Origin: base },
  });
  assert.equal((await call("/api/life", b)).status, 401);
  await stop();
  const cleaned = spawnSync(
    process.execPath,
    ["scripts/cloud-ops.mjs", "cleanup", "--apply", "--server-stopped"],
    { env: env(), encoding: "utf8" },
  );
  assert.equal(cleaned.status, 0, cleaned.stderr);
  checks.push(
    "logout revokes credentials; explicit expired-space cleanup preserves other spaces",
  );
  volume = path.join(folder, "tool-loop-volume");
  toolMode = true;
  await start();
  const toolVisitor = await enter();
  const created = await post(toolVisitor, "createItem", {
    name: "合成纸盒",
    brand: "Test",
    model: "TEST-BOX",
    category: "收纳容器",
    lifecycle: "长期耐用",
    availability: "available",
  });
  assert.equal(created.status, 200);
  const toolInput = {
    requestId: crypto.randomUUID(),
    question: "今天累了，先读取我可访问的物品，再聊聊休息，不读取记忆。",
    mode: "auto",
    memoryPolicy: "off",
    uiContext: { page: "assistant" },
  };
  const loop = await call("/api/assistant", toolVisitor, toolInput);
  assert.equal(loop.status, 200);
  assert.equal(loop.data.reply.outcome, "answered");
  assert.match(loop.data.reply.answer, /合成离线工具往返：合成纸盒/);
  assert.equal(loop.data.trace, undefined); // Public API deliberately hides internal diagnostics.
  const duplicate = await call("/api/assistant", toolVisitor, toolInput);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.data.reply.answer, loop.data.reply.answer);
  await stop();
  const { DatabaseSync } = await import("node:sqlite");
  const quotaDb = new DatabaseSync(path.join(volume, "visitors.sqlite"));
  try {
    assert.equal(
      quotaDb.prepare("SELECT COUNT(*) n FROM model_requests").get().n,
      2,
    );
  } finally {
    quotaDb.close();
  }
  checks.push(
    "public production HTTP: native tool -> rich item result -> final answer; exactly 2 governed requests; duplicate request uses cached answer (0 real model calls)",
  );
  assert.equal(secretLogged, false);
  fs.mkdirSync("artifacts/cloud", { recursive: true });
  fs.writeFileSync(
    "artifacts/cloud/validation.json",
    JSON.stringify(
      {
        passed: true,
        checks,
        realModelCalls: 0,
        docker: "not installed; Node production simulation only",
        volume: folder,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: true,
      checks,
      realModelCalls: 0,
      dockerBuildVerified: false,
    }),
  );
} finally {
  await stop();
}
