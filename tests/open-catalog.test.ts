import test from "node:test";
import assert from "node:assert/strict";
import { lookupOpenCatalog } from "../src/lib/life/open-catalog.ts";
test("开放条码/ISBN仅产生待确认元信息，来源许可保留、缓存命中、不猜持有/保质期", async () => {
  let calls = 0;
  const read = async (url: string) => {
    calls++;
    return {
      url,
      title: "json",
      links: [],
      text: JSON.stringify(
        url.includes("openlibrary")
          ? {
              "ISBN:9780140328721": {
                title: "Matilda",
                authors: [{ name: "Roald Dahl" }],
                publish_date: "1988",
                publishers: [{ name: "Puffin" }],
              },
            }
          : {
              product: {
                product_name: "测试食品",
                brands: "测试",
                code: "3017620422003",
                quantity: "400 g",
                last_modified_t: 123,
              },
            },
      ),
    };
  };
  const food = await lookupOpenCatalog("3017620422003", read),
    book = await lookupOpenCatalog("9780140328721", read);
  assert.equal(food.candidates[0].category, "食品");
  assert.match(food.candidates[0].license, /ODbL/);
  assert.equal(book.candidates[0].brand, "Roald Dahl");
  assert.equal(book.candidates[0].model, "9780140328721");
  assert.equal((food.candidates[0] as any).expiresOn, undefined);
  assert.equal(
    (
      await lookupOpenCatalog("3017620422003", () => {
        throw Error("cache miss");
      })
    ).cached,
    true,
  );
  assert.equal(calls, 2);
  await assert.rejects(lookupOpenCatalog("3017620422004", read), /校验位/);
  assert.equal(calls, 2);
});
