import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3213";
const dir = process.env.TEST_EVIDENCE_DIR || "docs/engineering/product-foundation-2026-10-30/evidence";
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const a = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
  b = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
const pa = await a.newPage(),
  pb = await b.newPage(),
  report = {
    at: new Date().toISOString(),
    synthetic: true,
    paidModelCalls: 0,
    pageErrors: [],
    checks: [],
  };
for (const p of [pa, pb])
  p.on("pageerror", (e) => report.pageErrors.push(e.message));
function check(name, data = {}) {
  report.checks.push({ name, passed: true, ...data });
  fs.writeFileSync(`${dir}/browser.json`, JSON.stringify(report, null, 2));
}
async function post(p, url, body) {
  const r = await p.request.post(base + url, { data: body });
  const d = await r.json();
  if (!r.ok()) throw Error(`${url}: ${r.status()} ${d.error}`);
  return d;
}
const life = (p, action, input) => post(p, "/api/life", { action, input });
async function register(p, who) {
  await p.goto(base);
  await p
    .getByLabel("用户名", { exact: true })
    .fill(`${who}_${Date.now().toString().slice(-9)}`);
  await p
    .getByLabel("口令", { exact: true })
    .fill(randomBytes(18).toString("hex"));
  await p.getByRole("checkbox").check();
  await p.getByRole("button", { name: "进入我的物间", exact: true }).click();
  await p.getByRole("button", { name: "生活首页", exact: true }).waitFor();
  const d = await (await p.request.get(base + "/api/account")).json();
  assert.match(d.account.id, /^u_/);
  return d.account;
}
async function item(p, name, model, category = "其他", brand = "Wujian") {
  return (
    await life(p, "createItem", {
      name,
      category,
      brand,
      model,
      lifecycle: "长期耐用",
      availability: "available",
      ownsConfirmed: true,
      synthetic: true,
      requestId: randomUUID(),
    })
  ).item;
}
try {
  const ua = await register(pa, "验收甲"),
    ub = await register(pb, "验收乙");
  assert.notEqual(ua.id, ub.id);
  assert.equal(
    await pa.getByRole("combobox", { name: "演示家庭成员" }).count(),
    0,
  );
  check("两独立浏览器实际注册登录，没有角色下拉模拟");
  // Use the real intake UI for an unseen SKU, not only API setup fixtures.
  await pa.goto(`${base}/#add`);
  await pa
    .getByText("录入其他真实商品、说明书或自己的纪念物", { exact: true })
    .click();
  await pa
    .getByLabel("物品名称", { exact: true })
    .fill("[合成]界面录入WH-CH520");
  await pa.getByLabel("品牌", { exact: true }).fill("Sony");
  await pa.getByLabel("具体型号", { exact: true }).fill("WH-CH520");
  await pa.getByText("商品链接、公开资料或说明书", { exact: true }).click();
  await pa
    .getByLabel("公开 HTTPS 链接", { exact: true })
    .fill("https://helpguide.sony.net/mdr/2958/v1/en/index.html");
  await pa.getByRole("button", { name: "主动读取这份公开资料" }).click();
  await pa
    .getByText(/已联网取得官方站点、匹配完整型号的资料草稿/)
    .waitFor({ timeout: 30000 });
  await pa.getByLabel("我确认拥有这件商品", { exact: true }).check();
  await pa
    .getByLabel("这是体验用测试物品，不代表真实持有", { exact: true })
    .check();
  await pa.getByRole("button", { name: "确认并录入物品", exact: true }).click();
  await pa
    .getByRole("button", { name: "资料与管理", exact: true })
    .waitFor({ timeout: 30000 });
  check("陌生SKU经真实录入界面读取官方资料、确认持有并保存");
  const painting = await item(pa, "[合成]朋友送的画", "无品牌原创");
  await life(pa, "updateItem", {
    itemId: painting.id,
    attributes: { dimensions: "40×30厘米（合成用户报告）" },
    note: "模拟持有，不是真实用户历史",
  });
  const selected = (
    await life(pa, "fragment", {
      itemIds: [painting.id],
      text: "[合成经历]朋友小周送了这幅画；没有记录具体日期或其他情感关系。",
      allowRecall: true,
      allowCloud: false,
      origin: "user-record",
    })
  ).fragment;
  await life(pa, "fragment", {
    itemIds: [painting.id],
    text: "[合成私密]这段经历不随礼物传递。",
    allowRecall: true,
    allowCloud: false,
    origin: "user-record",
  });
  await pa.reload();
  await pa.getByRole("button", { name: "物品展柜", exact: true }).click();
  await pa.getByText(painting.name, { exact: true }).first().click();
  await pa.getByLabel("为它启用数字分身", { exact: true }).check();
  await pa.getByLabel("分身的名字", { exact: true }).fill("旅途");
  const savedPersona = pa.waitForResponse(
    (r) => r.url().endsWith("/api/memories") && r.request().method() === "POST",
  );
  await pa.getByRole("button", { name: "保存分身设置", exact: true }).click();
  assert.ok((await savedPersona).ok());
  await pa.reload();
  await pa.getByRole("button", { name: "物品展柜", exact: true }).click();
  await pa.getByText(painting.name, { exact: true }).first().click();
  await expect(pa.getByLabel("分身的名字", { exact: true })).toHaveValue(
    "旅途",
  );
  const remembered = await post(pa, "/api/memories", {
    action: "rememberItemStory",
    input: {
      fragmentId: selected.id,
      revision: selected.revision,
      itemId: painting.id,
      allowCloud: false,
      requestId: randomUUID(),
    },
  });
  const memory = remembered.memory;
  assert.ok(memory?.id);
  const ask = () =>
    post(pa, "/api/assistant", {
      requestId: randomUUID(),
      itemId: painting.id,
      mode: "auto",
      question: "这幅画是谁送我的？不要补充日期。",
      memoryPolicy: "off",
      uiContext: { page: "item", companion: true, useItemMemories: true },
    });
  const firstRecall = await ask();
  assert.ok(JSON.stringify(firstRecall.reply).includes("小周"));
  await post(pa, "/api/memories", {
    id: memory.id,
    requestId: randomUUID(),
    memory: {
      itemId: painting.id,
      kind: "relationship",
      text: "合成纠正：同事小叶赠送，不是小周。没有记录日期。",
      allowCloud: false,
    },
  });
  const corrected = await ask();
  assert.ok(JSON.stringify(corrected.reply).includes("小叶"));
  const forgotten = await pa.request.delete(base + "/api/memories", {
    data: { id: memory.id },
  });
  assert.ok(forgotten.ok());
  const finalRecall = await ask();
  assert.ok(!(finalRecall.reply.memoryIds || []).includes(memory.id));
  assert.ok(!finalRecall.reply.answer.includes("同事小叶"));
  await pa.screenshot({ path: `${dir}/persona-desktop.png`, fullPage: true });
  check("真实界面保存分身、跨会话本地召回、纠正与遗忘；未冒充模型表现");
  const hidden = await pb.request.get(base + `/api/life?itemId=${painting.id}`);
  assert.equal(hidden.status(), 403);
  const spoof = await (
    await pb.request.get(base + "/api/life", {
      headers: { "x-demo-actor": ua.id },
    })
  ).json();
  assert.ok(!spoof.workspace.items.some((i) => i.id === painting.id));
  check("独立账号不能通过演示头冒充另一用户");
  const invite = await post(pa, "/api/collaboration", {
    action: "invite",
    confirmed: true,
    requestId: randomUUID(),
  });
  await post(pb, "/api/collaboration", {
    action: "join",
    token: invite.invite,
    confirmed: true,
    requestId: randomUUID(),
  });
  assert.equal(
    (await pb.request.get(base + `/api/life?itemId=${painting.id}`)).status(),
    403,
  );
  await post(pa, "/api/collaboration", {
    action: "share",
    itemId: painting.id,
    memberId: ub.id,
    enabled: true,
    requestId: randomUUID(),
  });
  const shared = await (
    await pb.request.get(base + `/api/life?itemId=${painting.id}`)
  ).json();
  assert.equal(shared.fragments.length, 0);
  check("加入家庭不等于共享；共享档案不泄露私人故事");
  await pa.reload();
  await pa.getByRole("button", { name: "家庭", exact: true }).click();
  await pa.getByLabel("一起使用的物品").selectOption(painting.id);
  await pa.getByLabel("交给谁").selectOption(ub.id);
  await pa.getByLabel("需要帮忙的事情").fill("帮忙核对画框摆放支撑");
  await pa
    .getByLabel("家人会看到的摘要")
    .fill("支撑尚未确认，请先检查，不放在桌沿；这是合成验收。未转发私聊。");
  await pa.getByRole("button", { name: "确认摘要，创建事项" }).click();
  await pa.getByText("帮忙核对画框摆放支撑", { exact: true }).waitFor();
  await pb.reload();
  await pb.getByRole("button", { name: "家庭", exact: true }).click();
  await pb.getByRole("button", { name: "标记已看到" }).click();
    await pb.getByRole("combobox", { name: "界面版本", exact: true }).selectOption("elder");
    await pb.getByRole("button", { name: "家人交代的事", exact: true }).click();
    await pb.getByRole("button", { name: "我来接手", exact: true }).click();
    await expect(pb.getByRole("button", { name: "我已完成", exact: true })).toBeEnabled();
    await pb.screenshot({ path: `${dir}/care-mobile.png`, fullPage: true });
    await pb.getByRole("button", { name: "我已完成", exact: true }).click();
    await pb.getByText("暂时没有需要处理的事。", { exact: true }).waitFor();
    await pb.getByRole("combobox", { name: "界面版本", exact: true }).selectOption("standard");
    await pb.getByRole("button", { name: "家庭", exact: true }).click();
  await pb.getByText(/用户报告完成，非设备检测/).waitFor();
  assert.ok(
    (
      await (await pa.request.get(base + "/api/collaboration")).json()
    ).workspace.tasks.some(
      (t) => t.reportedAt && t.completionBasis === "user_report",
    ),
  );
  await pb.screenshot({ path: `${dir}/family-mobile.png`, fullPage: true });
  check("家庭事项在真实独立身份间创建、已读、接手、用户报告完成");
  const gift = (
    await life(pa, "gift", {
      itemId: painting.id,
      message: "[合成寄语]让它继续陪伴新的日常",
      fragmentIds: [selected.id],
    })
  ).gift;
  await pb.goto(`${base}/gift/${gift.token}`);
  await pb
    .getByRole("heading", { name: "有一份心意，想交到你手里。" })
    .waitFor();
  await pb.getByLabel("我确认已实际取得这件物品").check();
  await pb.getByRole("button", { name: "认领并延续记忆" }).click();
  await pb.getByText("礼物已认领。", { exact: false }).waitFor();
  const ws = await (await pb.request.get(base + "/api/workspace")).json(),
    received = ws.items.find((i) => i.transferredFrom?.giftId === gift.id);
  assert.ok(
    received && received.id !== painting.id && received.owner === ub.id,
  );
  assert.ok(!JSON.stringify(ws).includes("这段经历不随礼物传递"));
  await life(pb, "fragment", {
    itemIds: [received.id],
    text: "[合成]新主人的私人经历，不回流",
    allowRecall: true,
    allowCloud: false,
    origin: "user-record",
  });
  assert.ok(
    !JSON.stringify(
      await (await pa.request.get(base + "/api/life")).json(),
    ).includes("新主人的私人经历"),
  );
  await pb.screenshot({ path: `${dir}/gift-mobile.png`, fullPage: true });
  check("独立收礼者预览认领、独立实例、选择故事作者保留、新私密不回流");
  const sony = await item(
    pa,
    "[合成]新录入WH-CH520",
    "WH-CH520",
    "电子设备",
    "Sony",
  );
  let imported;
  try {
    imported = await life(pa, "importOfficial", {
      itemId: sony.id,
      url: "https://helpguide.sony.net/mdr/2958/v1/en/index.html",
      confirmed: true,
    });
    check("陌生产品真实官网资料导入，非预置资料包", {
      url: imported.source.url,
    });
  } catch (e) {
    report.checks.push({
      name: "陌生产品真实官网导入",
      passed: false,
      error: e.message,
    });
  }
  await pa.reload();
  await pa.getByRole("button", { name: "物品展柜", exact: true }).click();
  await pa.getByText(sony.name, { exact: true }).first().click();
  await pa.getByRole("button", { name: "资料与管理", exact: true }).click();
  await pa.screenshot({ path: `${dir}/new-item-desktop.png`, fullPage: true });
  const lab = await post(pa, "/api/device-lab", {
    action: "create",
    confirmed: true,
    requestId: randomUUID(),
  });
  await pa.reload();
  await pa.getByRole("button", { name: "物品展柜", exact: true }).click();
  await pa.getByText(lab.item.name, { exact: true }).first().click();
  await pa.getByRole("button", { name: "资料与管理", exact: true }).click();
  await pa.getByRole("button", { name: "让物间分析这个软件的能力" }).click();
  await pa
    .getByRole("button", { name: "只授权本机软件灯的调光与回读" })
    .click({ timeout: 60000 });
  await pa.getByLabel("希望的亮度").fill("42");
  await pa.getByRole("button", { name: "确认调整并核对实际状态" }).click();
  await pa.getByText(/软件灯回读：亮度42/).waitFor();
  await pa.screenshot({
    path: `${dir}/software-readback-desktop.png`,
    fullPage: true,
  });
  await pa.getByRole("button", { name: "撤销软件控制授权" }).click();
  check("真实浏览器REA分析、明确授权、执行软件灯调光42、回读、撤权");
  await pa.setViewportSize({ width: 390, height: 844 });
  const overflow = await pa.evaluate(
    () => document.documentElement.scrollWidth > innerWidth + 1,
  );
  assert.equal(overflow, false);
  await pa.screenshot({ path: `${dir}/software-mobile.png`, fullPage: true });
  check("390px移动端无横向溢出");
  assert.equal(report.pageErrors.length, 0);
} catch (e) {
  report.failure = e.message;
  throw e;
} finally {
  fs.writeFileSync(`${dir}/browser.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
