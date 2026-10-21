/** Offline end-to-end revalidation of this round's synthetic MAF10 response, with current graph/validator. */
import fs from "node:fs";
import path from "node:path";
import { validationFixture } from "./life-validation-fixture.ts";
import { respond } from "../src/lib/agent/service.ts";

const source = path.join(
  process.cwd(),
  ".runtime",
  "knowledge-creative-20261020",
);
const ledger = JSON.parse(
  fs.readFileSync(path.join(source, "ledger.json"), "utf8"),
);
const recorded = ledger.requests.find((r: any) => r.number === 23);
if (!recorded?.output?.content)
  throw Error("No recorded synthetic response; replay cannot proceed");
const directory = fs.mkdtempSync(
  path.join(process.cwd(), ".runtime", "product-replay-"),
);
fs.copyFileSync(
  path.join(source, "test.sqlite"),
  path.join(directory, "test.sqlite"),
);
const t = validationFixture(directory);
process.env.WUJIAN_ALLOW_PUBLIC_FETCH = "false";
process.env.WUJIAN_ALLOW_SEARCH = "false";
process.env.AI_ALLOW_PAID_CALLS = "false";
process.env.WUJIAN_ALLOW_PAID_CALLS = "false";
let replayed = 0;
try {
  const item = t.read().items.find((i) => i.model === "MAF10")!;
  const result = await respond(
    t.db,
    t.read,
    "lin",
    {
      question: "我是第一次使用，能不能带我从准备到完成一次烹饪？",
      itemId: item.id,
      requestId: crypto.randomUUID(),
      mode: "auto",
      memoryPolicy: "off",
      uiContext: { page: "item" },
    },
    {
      ready: true,
      model: "recorded-qwen-plus",
      generate: async () => {
        throw Error("Offline replay has no generation endpoint");
      },
      complete: async () => {
        if (++replayed > 1)
          throw Error("Recorded response rejected; no simulated retry");
        return {
          text: recorded.output.content,
          model: "recorded-qwen-plus",
          tokens: null,
          toolCalls: [],
          finishReason: "stop",
        };
      },
    },
  );
  const report = {
    realModelCalls: 0,
    replayedRequests: replayed,
    syntheticDatabase: directory,
    sessionId: result.session.id,
    reply: result.reply,
  };
  fs.writeFileSync(
    path.join(source, "product-offline-replay.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        ...report,
        reply: {
          outcome: result.reply.outcome,
          steps: result.reply.steps,
          caveat: result.reply.caveat,
        },
      },
      null,
      2,
    ),
  );
} finally {
  t.db.close();
}
