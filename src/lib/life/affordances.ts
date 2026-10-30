import type { Item } from "../domain.ts";
import { itemContext } from "../context/items.ts";
import { boundPack } from "../ai/harness.ts";
import { physicalFactSchema } from "./physical-facts.ts";

export type EvidenceFact = {
  ref: string;
  item: string;
  component: string;
  key: string;
  value: unknown;
  basis: "official_source" | "user_report";
  text: string;
  sourceRef: string;
  url?: string;
};
export type EvidenceInventory = {
  items: {
    ref: string;
    id: string;
    name: string;
    quantity: number | null;
    facts: EvidenceFact[];
    unknowns: string[];
    operations: {
      ref: string;
      title: string;
      steps: string[];
      conditions: string[];
    }[];
  }[];
};
/** Only an explicit dimension expression, not arbitrary numbers in a manual.
 * Missing axis, diameter, inner/outer ambiguity or mixed units remain unknown. */
export function dimensionsMm(
  text: string,
): [number, number, number] | undefined {
  const m = text.match(
    /(?:宽|长)?\s*(\d+(?:\.\d+)?)\s*[×xX*、,，]\s*(?:深|宽)?\s*(\d+(?:\.\d+)?)\s*[×xX*、,，]\s*(?:高)?\s*(\d+(?:\.\d+)?)\s*(mm|毫米|cm|厘米|公分)/,
  );
  if (!m) return;
  const scale = /mm|毫米/.test(m[4]) ? 1 : 10;
  return [+m[1] * scale, +m[2] * scale, +m[3] * scale];
}
export function evidenceInventory(items: Item[]): EvidenceInventory {
  let counter = 0;
  return {
    items: items.map((item, index) => {
      const ref = `i${index + 1}`,
        card = itemContext(item),
        pack = boundPack(item),
        facts: EvidenceFact[] = [];
      const add = (
        key: string,
        value: unknown,
        text: string,
        basis: EvidenceFact["basis"],
        sourceRef: string,
        component = "本体",
        url?: string,
      ) =>
        facts.push({
          ref: `f${++counter}`,
          item: ref,
          component,
          key,
          value,
          text,
          basis,
          sourceRef,
          url,
        });
      add(
        "identity",
        item.name,
        item.name,
        "user_report",
        item.id + "/identity",
      );
      if (card.properties.material)
        add(
          "material",
          card.properties.material,
          card.properties.material,
          "user_report",
          item.id + "/material",
        );
      if (card.properties.dimensions) {
        const dims = dimensionsMm(card.properties.dimensions);
        add(
          dims ? "outer_mm" : "dimension_statement",
          dims || card.properties.dimensions,
          card.properties.dimensions,
          "user_report",
          item.id + "/dimensions",
        );
      }
      const capabilities: Record<string, string> = {
        "indoor-storage": "open_container",
        storage: "open_container",
        容纳: "open_container",
        容纳非食品轻小物: "open_container",
        透明可视: "transparent",
        提拿: "portable",
        "audio-playback": "sound",
        lighting: "light",
        clamp: "clamp",
        夹持: "clamp",
        照明: "light",
        便携: "portable",
        发声: "sound",
      };
      for (const cap of card.properties.capabilities) {
        const key = capabilities[cap];
        add(
          key || "capability_statement",
          key ? true : cap,
          cap,
          "user_report",
          item.id + "/capabilities",
        );
      }
      for (const cap of pack?.capabilities || []) {
        const key = capabilities[cap];
        if (key)
          add(
            key,
            true,
            cap,
            "official_source",
            `${pack!.id}/capability/${cap}`,
            "本体",
            pack!.source.url,
          );
      }
      for (const claim of card.officialFacts) {
        add(
          "statement",
          claim.text,
          claim.text,
          "official_source",
          claim.id,
          "本体",
          pack?.source.url,
        );
        const dims = dimensionsMm(claim.text);
        if (
          dims &&
          !/内(?:部)?(?:净)?尺寸/.test(
            claim.text.replace(
              /(?:不是|不代表|并非|非)内(?:部)?(?:净)?尺寸/g,
              "",
            ),
          )
        )
          add(
            "outer_mm",
            dims,
            claim.text,
            "official_source",
            claim.id,
            "本体",
            pack?.source.url,
          );
      }
      if (pack?.constraints?.maxLoadKg !== undefined)
        add(
          "max_load_kg",
          pack.constraints.maxLoadKg,
          "来源资料中的承重上限；不证明任意姿态稳定",
          "official_source",
          pack.id + "/maxLoadKg",
          "本体",
          pack.source.url,
        );
      for (const raw of item.attributes?.physicalFacts || []) {
        const parsed = physicalFactSchema.safeParse(raw);
        if (parsed.success) {
          const f = parsed.data;
          add(
            f.key,
            f.value,
            `${f.component}：${f.key}=${JSON.stringify(f.value)}（本人报告）`,
            "user_report",
            `${item.id}/physical/${f.id}`,
            f.component,
          );
        }
      }
      return {
        ref,
        id: item.id,
        name: item.name,
        quantity: item.attributes?.quantity ?? null,
        facts,
        unknowns: card.unknowns,
        operations: (pack?.procedures || []).map((p, i) => ({
          ref: `op${index + 1}_${i + 1}`,
          title: p.title,
          steps: p.steps.map((s) => s.text),
          conditions: [...p.preconditions, ...p.fieldChecks, ...p.limits],
        })),
      };
    }),
  };
}

export type GeometricResult = {
  status: "necessary_pass" | "impossible" | "unknown";
  explanation: string;
};
/** Necessary bounds only, axis-aligned or 90° turns. Not a 3D stability solver. */
export function boxFits(
  a: number[],
  b: number[],
  rotations = true,
): GeometricResult {
  if (
    a.length !== 3 ||
    b.length !== 3 ||
    [...a, ...b].some((n) => !Number.isFinite(n) || n < 0)
  )
    return { status: "unknown", explanation: "尺寸缺失或无效" };
  const orientations = rotations
    ? [
        [0, 1, 2],
        [0, 2, 1],
        [1, 0, 2],
        [1, 2, 0],
        [2, 0, 1],
        [2, 1, 0],
      ]
    : [[0, 1, 2]];
  return orientations.some((p) => p.every((axis, i) => a[axis] <= b[i]))
    ? {
        status: "necessary_pass",
        explanation:
          "轴对齐外包络必要条件通过，未验证内部形状、开口、间隙及稳定性",
      }
    : {
        status: "impossible",
        explanation:
          "已知外包络在所允许的轴向摆放中无法容纳；不代表计算任意斜置或可变形物体",
      };
}
export function twoRectanglesFit(
  a: number[],
  b: number[],
  space: number[],
): GeometricResult {
  if (
    [a, b, space].some(
      (v) =>
        v.length < 2 ||
        v.slice(0, 2).some((n) => !Number.isFinite(n) || n <= 0),
    )
  )
    return { status: "unknown", explanation: "缺少矩形占地尺寸" };
  const turn = (v: number[]) => [
    [v[0], v[1]],
    [v[1], v[0]],
  ];
  for (const x of turn(a))
    for (const y of turn(b))
      if (
        (x[0] + y[0] <= space[0] && Math.max(x[1], y[1]) <= space[1]) ||
        (Math.max(x[0], y[0]) <= space[0] && x[1] + y[1] <= space[1])
      )
        return {
          status: "necessary_pass",
          explanation:
            "两个轴对齐矩形在给定长宽内存在不重叠排布；不证明桌面实际空余或三维稳定",
        };
  return {
    status: "impossible",
    explanation: "两矩形在给定长宽内不能这样不重叠并排/前后放置（允许90°旋转）",
  };
}

/** Generic functional complement graph. These are search operators, not ideas. */
export function complementGraph(inventory: EvidenceInventory) {
  const roles = inventory.items.flatMap((i) =>
    i.facts
      .filter(
        (f) =>
          [
            "open_container",
            "clamp",
            "light",
            "reflective",
            "transparent",
            "elastic",
            "magnetic",
            "flat_surface",
            "sound",
          ].includes(f.key) && f.value === true,
      )
      .map((f) => ({ item: i.ref, function: f.key, evidence: f.ref })),
  );
  return {
    roles,
    combinations: roles
      .flatMap((a, index) =>
        roles
          .slice(index + 1)
          .filter((b) => b.item !== a.item && b.function !== a.function)
          .map((b) => ({
            a,
            b,
            relationship:
              "different-confirmed-functions; complementary effect still needs a causal explanation",
          })),
      )
      .slice(0, 24),
    transfers: [
      {
        principle:
          "把原来的输入替换为具有相同必要特征的新对象，逐项核对接口条件",
        source:
          "https://www.nist.gov/publications/functional-basis-engineering-design-reconciling-and-evolving-previous-efforts",
      },
      {
        principle: "从其他生活场景借用解决同一困难的作用，不照搬案例物品或结果",
        source: "https://www.designkit.org/methods/analogous-inspiration.html",
      },
    ],
    note: "No property is inferred from material or item name. An unlisted function remains an open hypothesis.",
  };
}
