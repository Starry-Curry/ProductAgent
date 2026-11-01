import test from "node:test";
import assert from "node:assert/strict";
import { extractPublicHTML } from "../src/lib/life/sources.ts";
import { findOfficial } from "../src/lib/life/knowledge.ts";
import { validationFixture } from "../scripts/life-validation-fixture.ts";
import { acquireKnowledge } from "../src/lib/life/acquisition.ts";
import { respond } from "../src/lib/agent/service.ts";
import type { Provider } from "../src/lib/ai/provider.ts";
test("无href的公开型号控件保留为ID，不虚构成真实链接", async () => {
  const d = await extractPublicHTML(
    '<title>Official catalogue</title><main><a id="item_C999">EOS TEST 900</a><p>Choose your product for manuals.</p></main>',
    "https://cam.start.canon/en/",
  );
  assert.deepEqual(d.navigationItems, [
    { id: "item_C999", label: "EOS TEST 900" },
  ]);
  assert.equal(d.links.length, 0);
});
test("陌生目录型号经实时ID映射、实际手册及JSON章节核对，无预置SKU答案", async () => {
  const reads: string[] = [];
  const result = await findOfficial(
    { brand: "Canon", model: "EOS TEST 900" },
    async (url) => {
      reads.push(url);
      if (url === "https://cam.start.canon/en/")
        return {
          url,
          title: "Live catalogue",
          text: "Catalogue of available models.",
          links: [],
          navigationItems: [
            { id: "item_C998", label: "EOS TEST 900 II" },
            { id: "item_C999", label: "EOS TEST 900" },
          ],
        };
      if (url.endsWith("/js/contents.json"))
        return {
          url,
          title: "Navigation",
          text: JSON.stringify([
            { title: "Movie shooting", link: "movie.html" },
            { title: "wrong scope", link: "https://evil.example/a.html" },
            { title: "wrong model", link: "../../other/index.html" },
          ]),
          links: [],
        };
      return {
        url,
        title: "Canon : EOS TEST 900",
        text: "EOS TEST 900 firmware 9.0 or later. Advanced User Guide.",
        links: [],
      };
    },
  );
  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0].links.length, 1);
  assert.ok(
    result.documents[0].links[0].url.endsWith("/C999/manual/html/movie.html"),
  );
  assert.equal(
    reads.some((u) => u.includes("C998")),
    false,
  );
  assert.ok(
    result.discoveryChains[result.documents[0].url].includes(
      "manufacturer_catalogue_id:item_C999",
    ),
  );
});
test("目录ID候选若返回别的型号，拒绝采用；动态目录不是来源事实认证", async () => {
  const result = await findOfficial(
    { brand: "Canon", model: "EOS TEST 900" },
    async (url) => ({
      url,
      title: url.endsWith("/en/") ? "Catalogue" : "EOS WRONG 901",
      text: "Public manufacturer document for a different product.",
      links: [],
      navigationItems: [{ id: "item_C999", label: "EOS TEST 900" }],
    }),
  );
  assert.equal(result.documents.length, 0);
});
// Structured-source and fragmented UTF-8 properties now use the actual Responses protocol in qwen-native.test.ts.

test("需要操作手册时不被已有产品介绍种子截断；仍是本轮服务端官方发现", async () => {
  const f = validationFixture(
    ".runtime/catalogue-preference-" + crypto.randomUUID(),
  );
  try {
    const seed = "https://www.canon.com.cn/product/generic/",
      item = f.add("[合成]陌生目录产品", "其他", "Canon", "EOS TEST 900", {
        supportUrl: seed,
      }),
      reads: string[] = [];
    const result = await acquireKnowledge(f.db, f.read, "lin", item, {
      preferManual: true,
      force: true,
      fetchDocument: async (url) => {
        reads.push(url);
        if (url === "https://cam.start.canon/en/")
          return {
            url,
            title: "Public catalogue",
            text: "Choose a model for the guide.",
            links: [],
            navigationItems: [{ id: "item_C999", label: "EOS TEST 900" }],
          };
        if (url.endsWith("/contents.json"))
          return {
            url,
            title: "TOC",
            text: JSON.stringify([
              { title: "Operations", link: "operate.html" },
            ]),
            links: [],
          };
        return {
          url,
          title: "EOS TEST 900 manual",
          text: "EOS TEST 900 official operation document, firmware conditions remain necessary.",
          links: [],
        };
      },
    });
    assert.equal(result.documents.length, 1);
    assert.ok(result.documents[0].url.includes("/C999/manual/"));
    assert.equal(reads.includes(seed), false);
    assert.equal(result.documents[0].sections?.[0].title, "Operations");
  } finally {
    f.db.close();
  }
});
test("自然用户消息候选保留资料包与权限，不把用户问题只埋在JSON；候选不默认启用", async (t) => {
  const f = validationFixture(".runtime/natural-layout-" + crypto.randomUUID()),
    id = f.add("[合成]物品", "其他", "Sony", "NATURAL-1");
  const previous = {
    runtime: process.env.WUJIAN_AGENT_RUNTIME,
    layout: process.env.WUJIAN_PRACTICAL_NATURAL_TURN,
  };
  process.env.WUJIAN_AGENT_RUNTIME = "native";
  process.env.WUJIAN_PRACTICAL_NATURAL_TURN = "true";
  t.after(() => {
    f.db.close();
    for (const [k, v] of [
      ["WUJIAN_AGENT_RUNTIME", previous.runtime],
      ["WUJIAN_PRACTICAL_NATURAL_TURN", previous.layout],
    ]) {
      if (v === undefined) delete process.env[k!];
      else process.env[k!] = v;
    }
  });
  const question = "只考虑当前用户获准的物品。";
  const provider: Provider = {
    ready: true,
    model: "offline-substitute",
    generate: async () => {
      throw Error("not_used");
    },
    converse: async (messages) => {
      assert.equal(JSON.parse(messages[1].content!).items[0].id, id);
      assert.equal(messages.at(-1)?.role, "user");
      assert.equal(messages.at(-1)?.content, question);
      return {
        text: "仅本轮数据，未执行设备操作。",
        model: "offline-substitute",
        tokens: null,
        finishReason: "stop",
        toolCalls: [],
      };
    },
  };
  await respond(
    f.db,
    f.read,
    "lin",
    {
      requestId: crypto.randomUUID(),
      question,
      itemId: id,
      mode: "service",
      memoryPolicy: "off",
    },
    provider,
  );
});
