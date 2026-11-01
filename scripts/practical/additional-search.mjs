import fs from "node:fs";
import { practicalGateway, ADDITIONAL_ROOT } from "./gateway.mjs";
import { createProvider } from "../../src/lib/ai/provider.ts";
const stage =
  process.argv.find((a) => a.startsWith("--stage="))?.slice(8) ||
  "search-smoke";
if (!/^[a-z0-9-]+$/.test(stage)) throw Error("invalid_stage");
const file = ADDITIONAL_ROOT + "/" + stage + ".json";
if (fs.existsSync(file)) throw Error("preserve_previous_evidence");
const gate = await practicalGateway({ additional: true, recordContent: true });
try {
  const provider = createProvider(
    {
      AI_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      AI_API_KEY: "fixture-only",
      AI_MODEL: process.argv.includes("--text-search")
        ? "qwen-plus-2025-12-01"
        : gate.model,
      AI_ALLOW_PAID_CALLS: "true",
      WUJIAN_ALLOW_PAID_CALLS: "true",
      WUJIAN_ALLOW_SEARCH: "true",
    },
    (url, init) => {
      const path = String(url).split("/aigc/")[1];
      if (!path) throw Error("search_endpoint_only");
      const body = JSON.parse(init.body);
      if (process.argv.includes("--early-sources")) {
        body.parameters.search_options.enable_citation = true;
        body.parameters.search_options.prepend_search_result = true;
        delete body.parameters.search_options.assigned_site_list;
      }
      return fetch(gate.url + "/browser/" + path, {
        ...init,
        body: JSON.stringify(body),
      });
    },
  );
  const result = await provider.search(
    "Sony SRS-XB100 official Help Guide Bluetooth pairing music volume",
    ["sony.net", "sony.com"],
  );
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        kind: "real_provider_search_not_document_verification",
        result,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ hits: result.hits, tokens: result.tokens }));
} catch (e) {
  fs.writeFileSync(
    file,
    JSON.stringify(
      { at: new Date().toISOString(), error: e.message },
      null,
      2,
    ) + "\n",
  );
  throw e;
} finally {
  await gate.close();
}
