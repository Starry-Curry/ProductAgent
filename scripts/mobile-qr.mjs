import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import ZX from "@zxing/library";
export async function createMobileQR(origin, { persistent = false } = {}) {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.username || url.password)
    throw Error("手机入口必须是 HTTPS URL");
  const target = url.origin + "/";
  const matrix = new ZX.QRCodeWriter().encode(
    target,
    ZX.BarcodeFormat.QR_CODE,
    0,
    0,
    new Map([
      [ZX.EncodeHintType.MARGIN, 4],
      [ZX.EncodeHintType.ERROR_CORRECTION, "M"],
    ]),
  );
  const size = matrix.getWidth();
  let squares = "";
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (matrix.get(x, y))
        squares += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size * 16}" height="${size * 16}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="white"/><g fill="#172a2e">${squares}</g></svg>`;
  const output = path.resolve("artifacts/mobile-delivery");
  fs.mkdirSync(output, { recursive: true });
  fs.mkdirSync("public/share", { recursive: true });
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const image = await sharp(png)
    .removeAlpha().toColourspace('b-w')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const decoded = new ZX.QRCodeReader()
    .decode(
      new ZX.BinaryBitmap(
        new ZX.HybridBinarizer(
          new ZX.RGBLuminanceSource(
            new Uint8ClampedArray(image.data),
            image.info.width,
            image.info.height,
          ),
        ),
      ), new Map([[ZX.DecodeHintType.PURE_BARCODE, true]]),
    )
    .getText();
  if (decoded !== target) throw Error("二维码回读校验未通过");
  fs.writeFileSync(path.join(output, "物间-手机扫码.png"), png);
  fs.writeFileSync(path.join(output, "物间-手机扫码.svg"), svg);
  fs.writeFileSync("public/share/phone-entry.png", png);
  fs.writeFileSync(
    path.join(output, "手机入口.txt"),
    `物间手机版\n${target}\n\n${persistent ? '固定二维码：电脑开机、登录、联网后自动恢复服务，重启不用更换二维码。关机、睡眠或合盖时不能使用 App；可熄屏，请保持开盖。无需打开 Codex 或终端。双击 START_MOBILE_SHARE.command 启动，STOP_MOBILE_SHARE.command 停止。' : '此二维码为当前 HTTPS 演示入口。演示电脑与分享进程需要保持运行；重开分享会产生新链接和二维码。'}\n`,
  );
  return {
    url: target,
    png: path.join(output, "物间-手机扫码.png"),
    svg: path.join(output, "物间-手机扫码.svg"),
    decoded,
    verified: true,
  };
}
if (process.argv[1] && path.basename(process.argv[1]) === "mobile-qr.mjs")
  console.log(JSON.stringify(await createMobileQR(process.argv[2], {persistent:process.argv.includes('--persistent')})));
