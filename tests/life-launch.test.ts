import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { launchStatus, portAvailable } from "../scripts/life-launch.mjs";

test("双击云端启动状态只返回配置布尔值，历史费用开关不代表授权", () => {
  const key = "offline-fixture-never-real";
  const status = launchStatus({ AI_API_KEY: key, AI_MODEL: "qwen-plus", AI_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1", AI_ALLOW_PAID_CALLS: "true", WUJIAN_ALLOW_PAID_CALLS: "true" });
  assert.equal(status.configured, true);
  assert.equal(JSON.stringify(status).includes(key), false);
  assert.match(status.message, /未开启费用授权/);
  assert.equal(launchStatus({}).keyPresent, false);
  assert.equal(launchStatus({ AI_API_KEY: key, AI_MODEL: "qwen-plus", AI_BASE_URL: "http://localhost" }).configured, false);
});
test("端口冲突检查不关闭占用者，也不占住空闲端口", async () => {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  try { assert.equal(await portAvailable(address.port), false); assert.equal(server.listening, true); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  assert.equal(await portAvailable(address.port), true);
  assert.equal(await portAvailable(address.port), true);
});
