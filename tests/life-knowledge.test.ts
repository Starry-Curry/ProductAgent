import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { seed, mutate, type State } from "../src/lib/domain.ts";
import { migrate } from "../src/lib/migrations.ts";
import { migrateLife } from "../src/lib/life/schema.ts";
import {
  findOfficial,
  modelMentioned,
  officialDomain,
  organizeKnowledge,
} from "../src/lib/life/knowledge.ts";
import {
  extractPublicHTML,
  parseCode,
  saveSource,
  sourceReply,
} from "../src/lib/life/sources.ts";
import { extractManual } from "../src/lib/life/documents.ts";
import { recognizeOwnedPhoto } from "../src/lib/life/vision.ts";
import { createProvider, ProviderError } from "../src/lib/ai/provider.ts";
import { respond } from "../src/lib/agent/service.ts";

function fixture() {
  const filename = path.join(
      mkdtempSync(path.join(tmpdir(), "wujian-knowledge-")),
      "test.sqlite",
    ),
    db = new DatabaseSync(filename);
  db.exec(
    "PRAGMA foreign_keys=ON;CREATE TABLE workspace(id INTEGER PRIMARY KEY,body TEXT NOT NULL)",
  );
  db.prepare("INSERT INTO workspace VALUES(1,?)").run(JSON.stringify(seed()));
  migrate(db, filename);
  migrateLife(db, filename);
  const read = () =>
    JSON.parse(
      (db.prepare("SELECT body FROM workspace").get() as { body: string }).body,
    ) as State;
  const write = (s: State) =>
    db.prepare("UPDATE workspace SET body=?").run(JSON.stringify(s));
  return { db, read, write };
}
test("普通型号官网查找只接受完整型号与官方域名，失败/未知品牌明确降级", async () => {
  const calls: string[] = [];
  const good = await findOfficial(
    { brand: "宜家", model: "305.976.49" },
    async (url) => {
      calls.push(url);
      return {
        title: "synthetic official fixture",
        text: "货号305.976.49。请用干布擦拭。",
        url,
        links: [],
      };
    },
  );
  assert.equal(good.documents.length, 1);
  assert.match(calls[0], /30597649/);
  const wrong = await findOfficial(
    { brand: "飞利浦", model: "HD9252/51" },
    async (url) => ({
      title: "HD9252/52",
      text: "另一个型号HD9252/52",
      url,
      links: [],
    }),
  );
  assert.equal(wrong.documents.length, 0);
  assert.match(wrong.issues[0], /未匹配完整型号/);
  const unknown = await findOfficial(
    { brand: "自有品牌", model: "TEST-27" },
    async () => {
      throw Error("must not call unregistered endpoint");
    },
  );
  assert.equal(unknown.documents.length, 0);
  assert.match(unknown.notice, /有限官方地址适配/);
  assert.equal(modelMentioned("型号XTEST-27A", "TEST-27"), false);
  assert.equal(
    officialDomain("https://mi.com.attacker.example/manual", "小米"),
    false,
  );
});
test("网页保留操作段落、说明书链接和直接提取候选；结构化字段不自动绑定", async () => {
  const d = await extractPublicHTML(
    '<html><head><title>TEST-27</title><script type="application/ld+json">{"@type":"Product","name":"普通风扇","brand":{"name":"测试品牌"},"model":"TEST-27"}</script></head><body><main><p>按下电源按钮开启风扇。</p><p>禁止将手伸入护网。</p><a href="/manual.pdf">使用说明书</a></main></body></html>',
    "https://example.org/product",
  );
  assert.match(d.text, /开启风扇。\n/);
  assert.equal(d.extracted?.model, "TEST-27");
  assert.equal(d.links[0].url, "https://example.org/manual.pdf");
  const k = organizeKnowledge(
    {
      id: "fixture",
      text: d.text,
      title: d.title,
      url: d.url,
      kind: "user-link",
    },
    "TEST-27",
  );
  for (const section of k.sections)
    assert.equal(d.text.slice(section.start, section.end), section.quote);
  assert.ok(k.sections.some((s) => s.category === "使用方法"));
  assert.ok(k.sections.some((s) => s.category === "注意事项"));
});
test("用户普通商品的怎么用可提取步骤；已有规格包不挡住手册操作；无证据不推测参数", async () => {
  const t = fixture();
  try {
    let s = mutate(t.read(), "lin", "createItem", {
      name: "普通风扇",
      model: "TEST-27",
      brand: "测试",
      category: "电子设备",
    });
    const id = s.items.at(-1)!.id;
    t.write(s);
    saveSource(t.db, t.read(), "lin", {
      itemId: id,
      title: "合成手册TEST-27",
      text: "型号TEST-27。按下电源按钮开启风扇。选择风速后使用。禁止把手伸入护网。",
      kind: "user-manual",
    });
    const r = await respond(
      t.db,
      t.read,
      "lin",
      {
        requestId: crypto.randomUUID(),
        question: "这个怎么用",
        mode: "auto",
        itemId: id,
        memoryPolicy: "off",
        uiContext: { page: "item" },
      },
      {
        ready: false,
        model: "offline",
        generate: async () => {
          throw Error("no network");
        },
      },
    );
    assert.match(r.reply.answer, /按下电源按钮/);
    assert.equal(r.modelCalls, 0);
    assert.equal(r.reply.source, "user-source");
    assert.equal(
      sourceReply(t.db, t.read(), "lin", id, "多少瓦")?.outcome,
      "needs_info",
    );
    assert.throws(
      () => sourceReply(t.db, t.read(), "dad", id, "怎么用"),
      /未获授权/,
    );
    s = mutate(t.read(), "lin", "createItem", {
      name: "已绑定鼠标",
      model: "M-R0061",
      category: "电子设备",
    });
    const mouse = s.items.at(-1)!.id;
    s = mutate(s, "lin", "bindProduct", {
      itemId: mouse,
      packId: "logitech-m185-m-r0061",
      confirmed: true,
    });
    t.write(s);
    saveSource(t.db, t.read(), "lin", {
      itemId: mouse,
      title: "合成补充操作资料",
      text: "这是合成测试章节，不是新增官方事实。按下开关开启鼠标，插入接收器后观察光标。",
      kind: "user-manual",
    });
    const help = await respond(
      t.db,
      t.read,
      "lin",
      {
        requestId: crypto.randomUUID(),
        question: "这个怎么用",
        mode: "auto",
        itemId: mouse,
        memoryPolicy: "off",
        uiContext: { page: "item" },
      },
      {
        ready: false,
        model: "offline",
        generate: async () => {
          throw Error("no network");
        },
      },
    );
    assert.match(help.reply.answer, /按下开关/);
  } finally {
    t.db.close();
  }
});
test("编码真实校验，不凭编码造商品；含完整型号的QR文字能匹配已有包", () => {
  assert.equal(parseCode("5901234123457").validChecksum, true);
  assert.equal(parseCode("5901234123458").validChecksum, false);
  assert.deepEqual(parseCode("5901234123457").candidates, []);
  assert.ok(parseCode("罗技 M185 M-R0061 使用资料").candidates.length > 0);
});
test("视觉复用Provider协议：默认费用关闭、照片逐次确认、仅本人读取，候选不升级事实", async () => {
  const t = fixture();
  const id = crypto.randomUUID();
  t.db
    .prepare("INSERT INTO life_media VALUES(?,?,?,?)")
    .run(id, "lin", "image/jpeg", Buffer.from("synthetic-not-a-real-photo"));
  const env = {
    AI_API_KEY: "offline-fake",
    AI_BASE_URL: "https://example.org/v1",
    AI_MODEL: "text",
    AI_VISION_MODEL: "vision-fixture",
    AI_ALLOW_PAID_CALLS: "true",
    WUJIAN_ALLOW_PAID_CALLS: "true",
    AI_ENABLE_THINKING: "false",
  };
  let calls = 0;
  const p = createProvider(
    { ...env, AI_MODEL: env.AI_VISION_MODEL },
    async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.messages[1].content[1].type, "image_url");
      assert.match(
        body.messages[1].content[1].image_url.url,
        /^data:image\/jpeg;base64,/,
      );
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                candidates: [
                  {
                    name: "杯子",
                    model: "imagined-42",
                    basis: "visual-inference",
                    uncertainties: ["型号不可辨"],
                  },
                ],
              }),
            },
          },
        ],
      });
    },
  );
  try {
    await assert.rejects(
      recognizeOwnedPhoto(t.db, "lin", id, false, env, p),
      /明确确认/,
    );
    await assert.rejects(
      recognizeOwnedPhoto(t.db, "dad", id, true, env, p),
      /未获授权/,
    );
    await assert.rejects(
      recognizeOwnedPhoto(
        t.db,
        "lin",
        id,
        true,
        { ...env, WUJIAN_ALLOW_PAID_CALLS: "false" },
        p,
      ),
      (e) => e instanceof ProviderError && e.code === "payment_not_authorized",
    );
    assert.equal(calls, 0);
    const r = await recognizeOwnedPhoto(t.db, "lin", id, true, env, p);
    assert.equal(calls, 1);
    assert.equal(r.candidates[0].model, undefined);
    assert.match(r.notice, /未经实物验证/);
  } finally {
    t.db.close();
  }
});
test("说明书图片实际本机OCR，无云端和运行时语言下载；不勾选时明确拒绝", async () => {
  const image = await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="220"><rect width="100%" height="100%" fill="white"/><text x="45" y="100" fill="black" font-family="Arial" font-size="48">TEST-27 Press the power button.</text></svg>',
    ),
  )
    .png()
    .toBuffer();
  await assert.rejects(extractManual(image, "manual.png"), /主动勾选本机 OCR/);
  const r = await extractManual(image, "manual.png", true);
  assert.equal(r.method, "local-ocr");
  assert.match(r.text, /power button/i);
  const jpeg = await sharp(image).jpeg().toBuffer(),
    content = "q 1200 0 0 220 0 40 cm /Im0 Do Q";
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1200 300] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>",
    ),
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width 1200 /Height 220 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      ),
      jpeg,
      Buffer.from("\nendstream"),
    ]),
    Buffer.from(
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ),
  ];
  let pdf = Buffer.from("%PDF-1.4\n");
  const offsets: number[] = [];
  for (let n = 0; n < objects.length; n++) {
    offsets.push(pdf.length);
    pdf = Buffer.concat([
      pdf,
      Buffer.from(`${n + 1} 0 obj\n`),
      objects[n],
      Buffer.from("\nendobj\n"),
    ]);
  }
  const xref = pdf.length;
  pdf = Buffer.concat([
    pdf,
    Buffer.from(
      `xref\n0 6\n0000000000 65535 f \n${offsets.map((n) => String(n).padStart(10, "0") + " 00000 n ").join("\n")}\ntrailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${xref}\n%%EOF`,
    ),
  ]);
  await assert.rejects(extractManual(pdf, "scan.pdf"), /扫描 PDF/);
  const scanned = await extractManual(pdf, "scan.pdf", true);
  assert.equal(scanned.method, "local-ocr");
  assert.match(scanned.text, /power button/i);
});
