import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { QRCodeWriter, BarcodeFormat } from "@zxing/library";
import sharp from "sharp";
import { writeFileSync, mkdirSync } from "node:fs";
const base = process.env.TEST_BASE_URL;
if (!base) throw Error("Set isolated TEST_BASE_URL");
function makePDF() {
  const text =
    "BT /F1 12 Tf 50 750 Td (Wujian synthetic manual: wipe with dry cloth.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n",
    offsets = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const x = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map((n) => String(n).padStart(10, "0") + " 00000 n ").join("\n")}\ntrailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${x}\n%%EOF`;
  return pdf;
}
const form = new FormData();
form.set("kind", "manual");
form.set(
  "file",
  new File([makePDF()], "synthetic.pdf", { type: "application/pdf" }),
);
const response = await fetch(base + "/api/life", {
  method: "POST",
  headers: { "x-demo-actor": "lin" },
  body: form,
});
const manual = await response.json();
assert.equal(response.status, 200, JSON.stringify(manual));
assert.match(manual.text, /dry cloth/);
const matrix = new QRCodeWriter().encode(
    "https://example.org/user-manual",
    BarcodeFormat.QR_CODE,
    300,
    300,
    new Map(),
  ),
  raw = Buffer.alloc(300 * 300 * 3, 255);
for (let y = 0; y < 300; y++)
  for (let x = 0; x < 300; x++)
    if (matrix.get(x, y)) raw.fill(0, (y * 300 + x) * 3, (y * 300 + x) * 3 + 3);
const qr = await sharp(raw, { raw: { width: 300, height: 300, channels: 3 } })
  .png()
  .toBuffer();
const digits = "5901234123457",
  L = [
    "0001101",
    "0011001",
    "0010011",
    "0111101",
    "0100011",
    "0110001",
    "0101111",
    "0111011",
    "0110111",
    "0001011",
  ],
  G = L.map((x) =>
    [...x]
      .reverse()
      .map((c) => (c === "1" ? "0" : "1"))
      .join(""),
  ),
  R = L.map((x) => [...x].map((c) => (c === "1" ? "0" : "1")).join("")),
  parities = [
    "LLLLLL",
    "LLGLGG",
    "LLGGLG",
    "LLGGGL",
    "LGLLGG",
    "LGGLLG",
    "LGGGLL",
    "LGLGLG",
    "LGLGGL",
    "LGGLGL",
  ];
let bars = "101";
for (let i = 1; i <= 6; i++)
  bars += (parities[Number(digits[0])][i - 1] === "L" ? L : G)[
    Number(digits[i])
  ];
bars += "01010";
for (let i = 7; i < 13; i++) bars += R[Number(digits[i])];
bars += "101";
assert.equal(bars.length, 95);
const width = 460,
  height = 180,
  barRaw = Buffer.alloc(width * height * 3, 255);
for (let y = 12; y < 168; y++)
  for (let i = 0; i < 95; i++)
    if (bars[i] === "1")
      for (let k = 0; k < 4; k++) {
        const x = 40 + i * 4 + k;
        barRaw.fill(0, (y * width + x) * 3, (y * width + x) * 3 + 3);
      }
const barcode = await sharp(barRaw, { raw: { width, height, channels: 3 } })
  .png()
  .toBuffer();
const photo = await sharp({
  create: { width: 240, height: 200, channels: 3, background: "#849d69" },
})
  .jpeg()
  .toBuffer();
const browser = await chromium.launch({
  executablePath:
    process.env.EDGE_PATH ||
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
  args: ["--disable-gpu"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(base);
  await page.getByRole("button", { name: "录入物品", exact: true }).click();
  await page.getByText("条形码 / 二维码", { exact: true }).click();
  await page
    .getByLabel("编码图片", { exact: true })
    .setInputFiles({ name: "qr.png", mimeType: "image/png", buffer: qr });
  await expect(page.getByText(/二维码包含链接，不代表是说明书/)).toBeVisible();
  assert.equal(
    await page.getByLabel("公开 HTTPS 链接", { exact: true }).inputValue(),
    "https://example.org/user-manual",
  );
  await page.getByLabel("编码图片", { exact: true }).setInputFiles({
    name: "barcode.png",
    mimeType: "image/png",
    buffer: barcode,
  });
  await expect(page.getByText(/已解析商品编码/)).toBeVisible();
  assert.equal(
    await page
      .getByLabel("或粘贴已解码的原始内容", { exact: true })
      .inputValue(),
    digits,
  );
  await page.getByLabel("物品名称", { exact: true }).fill("浏览器录入的绿植");
  await page.getByLabel("类别", { exact: true }).selectOption("植物");
  await page.getByLabel("生命周期", { exact: true }).selectOption("持续养护");
  await page.getByLabel("数量", { exact: true }).fill("1");
  await page
    .getByLabel("我确认它目前在手、完好且可用", { exact: true })
    .check();
  await page.getByLabel("上传物品照片", { exact: true }).setInputFiles({
    name: "synthetic-plant.jpg",
    mimeType: "image/jpeg",
    buffer: photo,
  });
  await expect(page.getByText(/已保存经过解码和压缩的照片/)).toBeVisible();
  await page
    .getByRole("button", { name: "确认并录入物品", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "浏览器录入的绿植", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "故事", exact: true }).click();
  await page
    .getByLabel("留下一句话", { exact: true })
    .fill("浏览器图文验收：今天给绿植拍照");
  await page.getByLabel(/照片（可选/).setInputFiles({
    name: "synthetic-story.jpg",
    mimeType: "image/jpeg",
    buffer: photo,
  });
  await expect(page.getByAltText("片段照片预览")).toBeVisible();
  await page.getByRole("button", { name: "保存生活片段", exact: true }).click();
  let article = page
    .locator("article")
    .filter({ hasText: "浏览器图文验收：今天给绿植拍照" });
  await expect(article).toBeVisible();
  await article.getByRole("button", { name: "编辑片段", exact: true }).click();
  await page
    .getByLabel("留下一句话", { exact: true })
    .fill("浏览器图文验收：已更正");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  article = page
    .locator("article")
    .filter({ hasText: "浏览器图文验收：已更正" });
  await expect(article).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await article.getByRole("button", { name: "删除片段", exact: true }).click();
  await expect(article).toHaveCount(0);
  assert.deepEqual(errors, []);
} catch(e) {
  mkdirSync("artifacts/life",{recursive:true});
  await page.screenshot({path:"artifacts/life/formats-failure.png",fullPage:true});
  throw e;
} finally {
  await browser.close();
}
const report = {
  passed: true,
  measuredAt: new Date().toISOString(),
  checks: [
    "真实 PDF 文字提取（合成PDF）",
    "浏览器实际解码 QR 和 EAN-13 图片",
    "浏览器照片录入、类别与生命周期",
    "浏览器图文新增、修改、删除",
  ],
  realModelCalls: 0,
};
mkdirSync("artifacts/life", { recursive: true });
writeFileSync("artifacts/life/formats.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
