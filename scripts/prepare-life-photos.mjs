import { mkdir, writeFile, readFile } from "node:fs/promises";
import sharp from "sharp";
const photos = {
  home: "1600585154340-be6161a56a0c",
  mouse: "1527814050087-3793815479db",
  speaker: "1608043152269-423dbba4e7e1",
  kitchen: "1556911220-bff31c812dba",
  furniture: "1494438639946-1ebd1d20bf85",
  books: "1495446815901-a7297e633e8d",
  clothes: "1434389677669-e08b4cac3105",
  bag: "1553062407-98eeb64c6a62",
  camera: "1516035069371-29a1b244cc32",
  plant: "1416879595882-3373a0480b5b",
  food: "1568702846914-96b305d2aaeb",
};
await mkdir("public/demo/life", { recursive: true });
const manifest = [];
for (const [name, id] of Object.entries(photos)) {
  const url = `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1000&q=80`;
  let body;
  try {
    body = await readFile(`public/demo/life/${name}.jpg`);
    await sharp(body).metadata();
  } catch {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw Error(`${name}: ${r.status}`);
    body = await sharp(Buffer.from(await r.arrayBuffer()))
      .resize(1000, 850, { fit: "inside" })
      .jpeg({ quality: 82 })
      .toBuffer();
    await writeFile(`public/demo/life/${name}.jpg`, body);
  }
  manifest.push({
    file: `${name}.jpg`,
    source: url,
    license: "https://unsplash.com/license",
    role: "分类示意照片，非该型号实拍；不是用户真实物品或经历",
    bytes: body.length,
  });
  console.log(name, body.length);
}
await writeFile(
  "public/demo/life/SOURCES.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
