// Real installed Edge, synthetic isolated data, no model/network requests.
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium, expect } from "@playwright/test";
const base = process.env.TEST_BASE_URL;
if (!base || !process.env.PRODUCT_AGENT_DATA_DIR?.includes("verification-"))
  throw Error("Run via scripts/verify-local.mjs storybook (isolated database)");
const output = "artifacts/storybook-reading";
fs.mkdirSync(output, { recursive: true });
async function api(action, input) {
  const r = await fetch(base + "/api/life", {
    method: action ? "POST" : "GET",
    headers: { "content-type": "application/json", "x-demo-actor": "lin" },
    ...(action
      ? {
          body: JSON.stringify(
            action === "demo" ? { action, confirmed: true } : { action, input },
          ),
        }
      : {}),
  });
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  return d;
}
await api("demo");
const initial = await api();
const single = initial.fragments.find((f) => f.mediaIds?.length === 1);
const multi = initial.fragments.find((f) => f.mediaIds?.length === 2);
const text = initial.fragments.find((f) => !f.mediaId);
assert.ok(single && multi && text && single.demo && multi.demo && text.demo);
assert.ok(
  initial.fragments.every(
    (f) => !/合成验收|验收旅行|合成案例|合成图文/.test(f.text),
  ),
);
assert.equal(single.itemIds.length, 2);
await api("storyOrganization", {
  command: "chapter",
  name: "慢下来的日子",
  fragmentIds: [single.id, multi.id],
});
const browser = await chromium.launch({
  executablePath:
    process.env.EDGE_PATH ||
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
  args: ["--disable-gpu"],
});
const checks = [],
  layouts = [],
  errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1365, height: 1000 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  const entry = (id) => page.locator(`[data-story-id="${id}"]`);
  const navigate = () =>
    page
      .getByRole("navigation", { name: "主要导航" })
      .getByRole("button", { name: "生活故事", exact: true })
      .click();
  const switchView = (label) =>
    page
      .getByRole("group", { name: "故事浏览方式" })
      .getByRole("button", { name: label, exact: true })
      .click();
  async function imagesReady() {
    // Lazy images below fold are deliberately scrolled into view before screenshots.
    for (const image of await page
      .locator(".life-stories img.story-scene")
      .all()) {
      await image.scrollIntoViewIfNeeded();
      await expect(image).toHaveJSProperty("complete", true);
      assert.ok(await image.evaluate((img) => img.naturalWidth > 0));
    }
    await page.locator(".life-stories h2").click();
    await page
      .locator(".story-photo-sequence")
      .evaluateAll((elements) => elements.forEach((el) => (el.scrollLeft = 0)));
    await page.evaluate(() => scrollTo(0, 0));
  }
  async function layout(label) {
    const result = await page.evaluate(() => {
      const visible = (e) =>
        e.getBoundingClientRect().width > 0 &&
        e.getBoundingClientRect().height > 0;
      const entries = [...document.querySelectorAll("article.story-entry")].map(
        (e) => {
          const r = e.getBoundingClientRect(),
            p = e.querySelector(".story-prose").getBoundingClientRect();
          return {
            type: e.dataset.storyType,
            width: r.width,
            height: r.height,
            proseHeight: p.height,
            minHeight: getComputedStyle(e).minHeight,
          };
        },
      );
      const images = [...document.querySelectorAll(".story-scene")]
        .filter(visible)
        .map((e) => {
          const r = e.getBoundingClientRect();
          return {
            width: r.width,
            height: r.height,
            fit: getComputedStyle(e).objectFit,
            source: e.getAttribute("src"),
            ratioError: Math.abs(
              r.width / r.height / (e.naturalWidth / e.naturalHeight) - 1,
            ),
          };
        });
      const buttons = [
        ...document.querySelectorAll(".story-open,.story-management summary"),
      ]
        .filter(visible)
        .map((e) => {
          const r = e.getBoundingClientRect();
          const x = r.x + r.width / 2,
            y = r.y + r.height / 2;
          return (
            y < 0 ||
            y > innerHeight ||
            e.contains(document.elementFromPoint(x, y))
          );
        });
      return {
        width: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        entries,
        images,
        buttonsClear: buttons.every(Boolean),
      };
    });
    await page.screenshot({
      path: output + "/layout-latest.png",
      fullPage: true,
    });
    assert.ok(
      result.documentWidth <= result.width + 1,
      label + ": document overflow",
    );
    assert.ok(result.buttonsClear, label + ": obscured actions");
    for (const e of result.entries) {
      assert.ok(e.width <= result.width && e.width > 200);
      if (e.type === "text")
        assert.ok(
          e.height < e.proseHeight + 180,
          label + ": meaningless text height " + JSON.stringify(e),
        );
    }
    for (const img of result.images) {
      assert.ok(
        img.source.startsWith("/api/life/media/"),
        "No inventory-image fallback",
      );
      assert.equal(img.fit, "contain", "Never crop personal scene photographs");
      assert.ok(
        img.ratioError < 0.03,
        "Image element must retain original aspect ratio",
      );
      assert.ok(
        img.width > 90 &&
          img.height > 90 &&
          img.width <= result.width &&
          img.height <= 470,
      );
    }
    layouts.push({ label, ...result });
  }
  await page.goto(base + "/#stories");
  await expect(entry(single.id)).toBeVisible();
  await expect(page.getByLabel("留下一句话", { exact: true })).toHaveCount(0);
  await expect(entry(single.id)).toHaveAttribute("data-story-type", "photo");
  await expect(entry(multi.id)).toHaveAttribute("data-story-type", "sequence");
  await expect(entry(text.id)).toHaveAttribute("data-story-type", "text");
  await expect(entry(text.id).locator("img")).toHaveCount(0);
  await expect(
    entry(single.id).getByRole("button", { name: "编辑片段", exact: true }),
  ).not.toBeVisible();
  await imagesReady();
  await layout("desktop-timeline");
  await page.screenshot({ path: output + "/desktop.png", fullPage: true });
  for (const [name, fragment] of [
    ["single-photo", single],
    ["multi-photo", multi],
    ["text-only", text],
  ])
    await entry(fragment.id).screenshot({ path: output + "/" + name + ".png" });
  checks.push(
    "Distinct single-photo / multi-photo / text layouts, original prose, no permanent composer or product images",
  );
  await switchView("按章节");
  await page.getByRole("button", { name: "慢下来的日子 2 段经历" }).click();
  await expect(page.locator("article.story-entry")).toHaveCount(2);
  await page.screenshot({ path: output + "/chapters.png", fullPage: true });
  await switchView("按物品");
  await page.getByLabel("按关联物品浏览").selectOption("life-sample-12");
  await expect(page.locator("article.story-entry")).toHaveCount(2);
  await switchView("时间流");
  checks.push(
    "Confirmed chapter and multi-item browsing filter same original events without copying",
  );
  await entry(single.id)
    .getByRole("button", { name: "旅行背包", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "旅行背包", exact: true }),
  ).toBeVisible();
  await navigate();
  await expect(
    entry(single.id).getByRole("button", { name: "阅读完整故事", exact: true }),
  ).toBeFocused();
  checks.push("Story → item → story returns to original reading position");
  for (const [name, width, height] of [
    ["desktop", 1365, 1000],
    ["mobile", 390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await imagesReady();
    await layout(name + "-timeline");
    await page.screenshot({
      path: output + "/" + name + ".png",
      fullPage: true,
    });
    await entry(multi.id)
      .getByRole("button", { name: "阅读完整故事", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(multi.text);
    await expect(dialog.locator("img")).toHaveCount(2);
    await page
      .getByRole("button", { name: "关闭故事详情", exact: true })
      .focus();
    await page.keyboard.press("Shift+Tab");
    assert.ok(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
    );
    await dialog.evaluate((el) => (el.scrollTop = el.scrollHeight));
    for (const action of await dialog.locator(".life-actions button").all()) {
      await action.scrollIntoViewIfNeeded();
      assert.ok(
        await action.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return el.contains(
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
          );
        }),
        "Detail management action is obscured",
      );
    }
    await expect(
      page.getByRole("button", { name: "关闭故事详情", exact: true }),
    ).toBeInViewport();
    assert.ok(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    );
    await dialog.evaluate((el) => (el.scrollTop = 0));
    await dialog.getByText("生活的一页", { exact: true }).click();
    await page.screenshot({ path: output + "/detail-" + name + ".png" });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(
      entry(multi.id).getByRole("button", {
        name: "阅读完整故事",
        exact: true,
      }),
    ).toBeFocused();
    checks.push(
      name +
        ": no overflow/meaningless text height/obscured controls, full detail, sticky close, focus trap and Escape return",
    );
  }
  await entry(multi.id)
    .getByRole("button", { name: "放大故事照片", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "下一张照片", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "下一张照片", exact: true }).click();
  await page.getByRole("button", { name: "关闭照片", exact: true }).click();
  await page.getByRole("button", { name: "写一段生活", exact: true }).click();
  const prose = "晚饭后把窗台擦干净，给自己留了一个可以发呆的角落。";
  await page.getByLabel("留下一句话", { exact: true }).fill(prose);
  await page.getByRole("button", { name: "保存生活片段", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  const created = (await api()).fragments.find((f) => f.text === prose);
  assert.ok(created);
  await entry(created.id).getByLabel("故事选项", { exact: true }).click();
  await entry(created.id)
    .getByRole("button", { name: "编辑片段", exact: true })
    .click();
  await page
    .getByLabel("留下一句话", { exact: true })
    .fill(prose + " 明天再添一枝花。");
  await page
    .locator('input[type="file"]')
    .setInputFiles("public/demo/stories/afternoon.jpg");
  await expect(page.getByAltText("片段照片预览")).toBeVisible();
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  await expect(entry(created.id)).toHaveAttribute("data-story-type", "photo");
  await imagesReady();
  await layout("mobile-edited-text-to-photo");
  if (
    !(await entry(created.id)
      .locator("details.story-management")
      .evaluate((el) => el.open))
  )
    await entry(created.id).getByLabel("故事选项", { exact: true }).click();
  page.once("dialog", (d) => d.accept());
  await entry(created.id)
    .getByRole("button", { name: "删除片段", exact: true })
    .click();
  await expect(entry(created.id)).toHaveCount(0);
  assert.equal(
    (await api()).fragments.some((f) => f.id === created.id),
    false,
  );
  checks.push(
    "390px real create → edit text to photo → delete; gallery navigation remains usable",
  );
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    browser: "installed Microsoft Edge",
    browserVersion: browser.version(),
    realModelCalls: 0,
    data: "isolated synthetic demo; licensed scene photos, not actual experiences",
    checks,
    layouts,
    subjectiveReadingQuality:
      "Awaiting user review; geometry and CRUD passing does not certify aesthetics",
  };
  fs.writeFileSync(
    output + "/checks.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      passed: true,
      checks,
      screenshotDirectory: output,
      realModelCalls: 0,
    }),
  );
} finally {
  await browser.close();
}
