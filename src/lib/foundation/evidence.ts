import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Person, State } from "../domain.ts";
import { readKnowledge, type KnowledgeChunk } from "../life/acquisition.ts";
import { productModel } from "./legacy.ts";
import { authorize } from "./policy.ts";
import { AgentError } from "../agent/contracts.ts";
import { bindReviewedFacts } from "./reviewed-facts.ts";
export type ClaimVerdict =
  "supported" | "refuted" | "not_found" | "conflicting";
export type EvidenceClaim = {
  version: "evidence-claim/1";
  claimId: string;
  subjectModelKey: string;
  predicate: string;
  normalizedValue: string;
  verdict: ClaimVerdict;
  derivation: "explicit" | "deterministic_rule" | "proposed_inference";
  assertedScope: { region: string; firmware: string };
  sourceRefs: {
    documentId: string;
    passageId: string;
    url: string;
    excerpt: string;
    textHash: string;
    retrievedAt: string;
  }[];
  confidenceBasis: string;
  verification:"literal_only";
};
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
/** Only literal evidence is accepted here. Semantic paraphrases require independent review. */
export function adjudicateClaim(input: {
  modelKey: string;
  model: string;
  region: string;
  predicate: string;
  value: string;
  supports?: {
    chunk: KnowledgeChunk;
    quote: string;
    fetchedAt: string;
    stance: "supports" | "refutes";
  }[];
  inference?: boolean;
}): EvidenceClaim {
  const passages = (input.supports || []).filter(
    (e) =>
      e.chunk.model.trim().toUpperCase() === input.model.trim().toUpperCase() &&
      e.chunk.region === input.region &&
      e.quote.length >= 4 &&
      e.chunk.text.includes(e.quote),
  );
  // Refutation must itself quote the negation of the literal proposition. The caller cannot
  // turn an unrelated quote or absence into a negative fact by setting a stance flag.
  const positive = passages.filter(
    (e) => e.stance === "supports" && e.quote === input.value,
  );
  const negative = passages.filter(
    (e) =>
      e.stance === "refutes" &&
      [
        "不支持",
        "不适合",
        "不得",
        "禁止",
        "not supported",
        "not approved",
        "not suitable",
      ].some((n) => e.quote.toLowerCase().includes(n)) &&
      e.quote === input.value,
  );
  const selected = [...positive, ...negative];
  const verdict: ClaimVerdict = input.inference
    ? "not_found"
    : positive.length && negative.length
      ? "conflicting"
      : negative.length
        ? "refuted"
        : positive.length
          ? "supported"
          : "not_found";
  return {
    version: "evidence-claim/1",
    claimId: hash(JSON.stringify(input)),
    subjectModelKey: input.modelKey,
    predicate: input.predicate,
    normalizedValue: input.value,
    verdict,
    derivation: input.inference ? "proposed_inference" : "explicit",
    assertedScope: { region: input.region, firmware: "unknown" },
    sourceRefs: selected.map((e) => ({
      documentId: e.chunk.documentId,
      passageId: e.chunk.id,
      url: e.chunk.url,
      excerpt: e.quote,
      textHash: hash(e.quote),
      retrievedAt: e.fetchedAt,
    })),
    confidenceBasis:
      verdict === "not_found"
        ? "缺少适用型号的逐字依据；不是明确否定"
        : "仅证明列出的原文存在；不自动认可原文之外的语义扩写",
    verification:"literal_only",
  };
}
export function readEvidenceClaims(
  db: DatabaseSync,
  state: State,
  actor: Person,
  itemId: string,
) {
  if (!authorize(db, state, actor, itemId).allowed)
    throw new AgentError("物品资料未获授权", 403);
  const item = state.items.find((i) => i.id === itemId)!,
    model = productModel(item)!;
  return {
    itemId,
    model,
    reviewedFacts:bindReviewedFacts(readKnowledge(db,state,actor,itemId)),
    instanceObservation:{basis:"user_report",availability:item.availability||"unknown",attributes:item.attributes||{},notice:"这是用户报告的个人实例信息，未由厂家或设备回读验证。"},
    claims: readKnowledge(db, state, actor, itemId).flatMap((d) =>
      d.chunks.map((chunk) =>
        adjudicateClaim({
          modelKey: model.modelKey,
          model: item.model,
          region: d.region,
          predicate: "source_excerpt",
          value: chunk.text,
          supports: [
            {
              chunk,
              quote: chunk.text,
              fetchedAt: d.fetchedAt,
              stance: "supports",
            },
          ],
        }),
      ),
    ),
    notice:
      "以下是适用资料原文，不是模型综合结论。未找到信息不等于厂家否定；私人实例状态仍是用户报告。",
  };
}
export function checkNumericRange(actual: number, min: number, max: number) {
  if (![actual, min, max].every(Number.isFinite) || min > max)
    throw new AgentError("数值范围无效");
  return {
    verdict: actual >= min && actual <= max ? "supported" : "refuted",
    derivation: "deterministic_rule",
    scope: "仅判断该数值是否在给定范围；不证明整体兼容、三维结构或安全",
    actual,
    min,
    max,
  };
}
