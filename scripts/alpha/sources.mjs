import { createHash } from "node:crypto";
import { fetchPublicDocument } from "../../src/lib/life/sources.ts";
import { alphaProductPacks } from "../../src/lib/catalog/alpha-products.ts";
import { root, saveReport } from "./shared.mjs";
import path from "node:path";
const rows = [];
for (const pack of alphaProductPacks) {
  try {
    const d = await fetchPublicDocument(pack.source.url);
    rows.push({
      id: pack.id,
      url: d.url,
      title: d.title,
      characters: d.text.length,
      sha256: createHash("sha256").update(d.text).digest("hex"),
      modelFound: d.text.includes(pack.model),
      parser: "existing Cheerio/public document parser",
      reviewedFacts: pack.claims,
      unknowns: pack.understanding.unknowns,
    });
    console.log(pack.id + " HTML parsed " + d.text.length);
  } catch (e) {
    rows.push({ id: pack.id, error: e.message });
    console.log(pack.id + " failed " + e.message);
  }
}
try {
  const url =
    "https://resources.ikea.cn/cn/zh/assembly_instructions/knagglig-qia-na-ge-he-song-mu__AA-2019275-3-1.pdf";
  const d = await fetchPublicDocument(url);
  rows.push({
    id: "knagglig-assembly-pdf",
    url,
    characters: d.text.length,
    sha256: createHash("sha256").update(d.text).digest("hex"),
    parser: "existing PDF parser",
    text: d.text.slice(0, 1400),
    note: "Pictographic assembly instructions do not authorize invented steps.",
  });
  console.log("assembly PDF parsed " + d.text.length);
} catch (e) {
  rows.push({
    id: "knagglig-assembly-pdf",
    error: e.message,
    note: "No assembly steps claimed from unread PDF.",
  });
  console.log("PDF unavailable " + e.message);
}
saveReport(path.join(root, "official-sources.json"), {
  checkedAt: new Date().toISOString(),
  rows,
});
