import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Item } from "../domain.ts";
import { referenceAppliance } from "../catalog/real-appliances.ts";
import { officialDomain, modelMentioned } from "./knowledge.ts";
import { productPacks } from "../products.ts";
export type ReferenceManual = {
  reviewedNotes?: {
    page: number;
    pages?: number[];
    title: string;
    text: string;
    method: string;
    checkedAt: string;
  }[];
  title: string;
  url: string;
  text: string;
  links: { title: string; url: string }[];
  fetchedAt: string;
  checkedAt: string;
  applicableModel: string;
  region: string;
  pdfSha256: string;
  pages: number[];
  totalPages: number;
  method: string;
};
const cache = new Map<string, ReferenceManual>();
/** Only fixed, hash-verified manufacturer documents selected for this exact item
 * identity. These are previously retrieved sources, never a claim of a live fetch. */
export function referenceManual(item: Item): ReferenceManual | undefined {
  const p = referenceAppliance(item);
  if (!p) return;
  let d = cache.get(p.id);
  if (!d) {
    try {
      d = JSON.parse(
        readFileSync(
          path.join(
            process.cwd(),
            "resources",
            "product-manuals-v1",
            `${p.id}.json`,
          ),
          "utf8",
        ),
      ) as ReferenceManual;
    } catch {
      return;
    }
    const seriesMapped =
      p.id === "logitech-m185-mr0061" &&
      p.model === "M-R0061" &&
      modelMentioned(d.text, "M185") &&
      productPacks.some(
        (pack) =>
          pack.id === "logitech-m185-m-r0061" &&
          pack.model === p.model &&
          pack.source.kind === "official",
      );
    if (
      d.url !== p.manualUrl ||
      d.applicableModel !== p.model ||
      d.region !== p.region ||
      !officialDomain(d.url, p.brand) ||
      !(modelMentioned(d.text, p.model) || seriesMapped) ||
      createHash("sha256").update(d.text).digest("hex") !== p.manualTextHash ||
      createHash("sha256")
        .update(JSON.stringify(d.reviewedNotes || []))
        .digest("hex") !== p.reviewedNotesHash
    )
      return;
    cache.set(p.id, d);
  }
  return d;
}

const reviewedTopics: Record<string, RegExp[]> = {
  "mi-lamp-1s-tw": [/怎么用|使用|开关|亮度|调光|旋钮|色温/],
  "philips-add6910-hk": [/童锁|热水|取水|出水|怎么用|使用/],
  "xiaomi-kettle2-uk": [
    /烧水|首次|第一次|怎么用|使用/,
    /清洗|清洁|水垢|除垢|保养/,
  ],
  "xiaomi-purifier4lite-global": [/清洗|清洁|水洗|清理滤芯/],
  "xiaomi-airfryer65-uk": [/清洗|清洁|洗碗机/],
  "xiaomi-g20lite-uk": [/充电/],
  "logitech-m185-mr0061": [/第一次|使用|充电|电池|连接/],
  "jbl-go4-global": [/配对|蓝牙|连接/, /充电/],
  "sony-wx350": [/怎么拍|如何拍|拍第一张|怎么使用拍摄|如何使用|怎么用/],
};
/** Narrow, clearly labelled fallback for reviewed manual topics. It does not turn
 * failed model output into evidence or claim to handle unreviewed device faults. */
export function reviewedReferenceGuidance(
  item: Item,
  question: string,
  tried: string[] = [],
  care = false,
): import("../agent/contracts.ts").AssistantReply | undefined {
  if (
    /重置|复位|故障|错误|报警|短接|带电|冒烟|漏电|兼容|接收器替换|传输|传照片|导出|删除|格式化/.test(
      question,
    )
  )
    return;
  const product = referenceAppliance(item),
    manual = referenceManual(item);
  if (!product || !manual?.reviewedNotes) return;
  const choices = (reviewedTopics[product.id] || [])
    .map((pattern, index) => ({ pattern, index }))
    .filter((c) => c.pattern.test(question));
  // A specific cleaning question wins over a generic use word in the same turn.
  const choice = choices.at(-1);
  if (!choice) return;
  const note = manual.reviewedNotes[choice.index];
  if (!note) return;
  const evidenceId = `reviewed:${product.id}:${product.reviewedNotesHash}:${choice.index}`;
  const all = note.text
    .split(/(?<=[。！？])\s*/)
    .filter(Boolean)
    .map((text, index) => ({ id: `${evidenceId}:${index}`, text }));
  const remaining = all.filter((s) => !tried.includes(s.id));
  if (!remaining.length) return;
  return {
    outcome: "answered",
    answer: "按这款产品已核对的说明书，可以这样做。",
    steps: remaining.slice(0, care ? 3 : 10),
    questions: [],
    source: "curated-guidance",
    citations: [
      {
        id: evidenceId,
        title: `${product.name} ${product.model} · ${note.title}（官方说明书中文转述）`,
        url: manual.url + "#page=" + (note.pages?.[0] || note.page),
        section: `PDF 第 ${(note.pages || [note.page]).join("、")} 页；${product.variant}`,
        kind: "official",
      },
    ],
    evidenceIds: [evidenceId],
    memoryIds: [],
    caveat: "以下为已核对的说明书中文笔记，未检测设备实际状态。",
  };
}
