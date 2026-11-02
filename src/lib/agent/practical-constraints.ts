import { createHash } from "node:crypto";
import type { TaskContext } from "../context/compiler.ts";
import { rangeCondition } from "./kernel/physical.ts";
export type NecessaryCheck = {
  id: string;
  label: string;
  itemIds: string[];
  satisfied: boolean | null;
  detail: string;
  operands: {
    sourceId: string;
    quote: string;
    value: unknown;
    basis: string;
    url?: string;
  }[];
  scope: string;
  physicallyVerified: false;
};
const id = (s: unknown) =>
  "condition:" +
  createHash("sha256").update(JSON.stringify(s)).digest("hex").slice(0, 20);

/** Typed measurements, never an intent router or product answer table. Operands
 * come from this turn or authorized exact-model documents, not model arguments. */
export function practicalConstraints(c: TaskContext): NecessaryCheck[] {
  const checks: NecessaryCheck[] = c.necessaryConditionChecks.map((n) => ({
    id: id(n),
    label: "已登记尺寸的二维占地",
    itemIds: n.itemIds,
    satisfied: n.result.satisfied,
    detail: n.result.notice + "；未核对高度",
    operands: n.operandIds.map((sourceId) => ({
      sourceId,
      quote: "已登记的毫米尺寸",
      value: c.items
        .flatMap((i) => i.physicalFacts)
        .find((f) => f.id === sourceId)?.value,
      basis: "user_report",
    })),
    scope: "二维矩形占地；不证明稳定、承重、连接或设备兼容",
    physicallyVerified: false,
  }));
  const phoneText=(text:string)=>[
    ...text.matchAll(/(?:手机|phone)[^。！？?;；\n]{0,160}/gi),
  ]
    .map((m) => m[0].split(/相机|camera/i)[0])
    .join("\n");
  const phone=phoneText(c.question),taskPhone=phoneText(c.currentTask?.goal||'');
  if (!phone&&!taskPhone) return checks;
  const specs = [
    {
      key: "weight",
      cn: "重量",
      label: "(?:Compatible (?:Mobile )?Phone Weight|兼容手机重量)",
      actual:
        /(?:实测|重(?:量|为|约)?|weighs?|weight)[\s:：]*(\d+(?:\.\d+)?)\s*(kg|公斤|千克|g|克)/gi,
      unit: "g",
    },
    {
      key: "width",
      cn: "宽度",
      label: "(?:Compatible (?:Mobile )?Phone Width|兼容手机宽度)",
      actual:
        /(?:宽(?:度|为|约)?|width)[\s:：]*(\d+(?:\.\d+)?)\s*(mm|毫米|cm|厘米)/gi,
      unit: "mm",
    },
    {
      key: "thickness",
      cn: "厚度",
      label: "(?:Compatible (?:Mobile )?Phone Thickness|兼容手机厚度)",
      actual:
        /(?:厚(?:度|为|约)?|thickness)[\s:：]*(\d+(?:\.\d+)?)\s*(mm|毫米|cm|厘米)/gi,
      unit: "mm",
    },
  ];
  const scale = (v: number, u: string) =>
    v * (/kg|公斤|千克/.test(u) ? 1000 : /cm|厘米/.test(u) ? 10 : 1);
  for (const spec of specs) {
    const current=[...phone.matchAll(spec.actual)],fromTask=current.length===0;
    const actuals = (fromTask?[...taskPhone.matchAll(spec.actual)]:current).map((m) => ({
      value: scale(+m[1], m[2]),
      quote: m[0],
    }));
    if (!actuals.length) continue;
    const pattern = new RegExp(
      spec.label +
        "[\\s:：]*(\\d+(?:\\.\\d+)?)[\\s]*(?:-|–|—|~|至)[\\s]*(\\d+(?:\\.\\d+)?)[\\s]*(kg|公斤|千克|g|克|mm|毫米|cm|厘米)(?![a-z])",
      "gi",
    );
    const groups = new Map<
      string,
      {
        source: TaskContext["evidence"][number];
        quote: string;
        min: number;
        max: number;
      }[]
    >();
    for (const s of (c.constraintEvidence||c.evidence).filter((s) => s.basis === "official"))
      for (const m of s.text.matchAll(pattern)) {
        if (
          (spec.unit === "g" && !/^(kg|g|公斤|千克|克)$/.test(m[3])) ||
          (spec.unit === "mm" && !/^(mm|cm|毫米|厘米)$/.test(m[3]))
        )
          continue;
        const row = {
          source: s,
          quote: m[0],
          min: scale(+m[1], m[3]),
          max: scale(+m[2], m[3]),
        };
        if (row.min > row.max) continue;
        const group = groups.get(s.itemId) || [];
        if (!group.some((r) => r.quote === row.quote && r.source.url === s.url))
          group.push(row);
        groups.set(s.itemId, group);
      }
    for (const [itemId, ranges] of groups) {
      const conflict =
        new Set(ranges.map((r) => r.min + ":" + r.max)).size > 1 ||
        new Set(actuals.map((a) => a.value)).size > 1;
      const r = ranges[0],
        a = actuals[0],
        result = rangeCondition(a.value, r.min, r.max);
      const operands = [
        ...actuals.map((a) => ({
          sourceId: fromTask?"user:approved-task-goal":"user:current-turn",
          quote: a.quote,
          value: a.value,
          basis: "user_report",
        })),
        ...ranges.map((r) => ({
          sourceId: r.source.id,
          quote: r.quote,
          value: [r.min, r.max],
          basis: "official",
          url: r.source.url,
        })),
      ];
      checks.push({
        id: id({ itemId, key: spec.key, operands }),
        label: "手机" + spec.cn + "必要条件",
        itemIds: [itemId],
        satisfied: conflict ? null : result.satisfied,
        detail: conflict
          ? "数值存在冲突，不能据此确认兼容"
          : `${a.value} ${spec.unit}；官方范围 ${r.min}–${r.max} ${spec.unit}；${result.satisfied ? "在此范围内" : "不满足此范围" + (result.excess > 0 ? "，超出 " + result.excess + " " + spec.unit : "")}`,
        operands,
        scope:
          "仅适用于手机；不得据此确认相机可安装、稳定、重心、夹具或完整设备兼容",
        physicallyVerified: false,
      });
    }
  }
  return checks;
}
export function readKnownConstraints(
  checks: NecessaryCheck[],
  requested: string[],
) {
  if (requested.some((id) => !checks.some((c) => c.id === id)))
    throw Error("条件ID不属于本次获准资料");
  return requested.length
    ? checks.filter((c) => requested.includes(c.id))
    : checks;
}
