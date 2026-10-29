import type { ItemContext } from "./items.ts";

/** Focused contradiction checks, not a universal physical or semantic verifier. */
export function itemAdviceIssues(text: string, contexts: ItemContext[]) {
  const issues: string[] = [];
  const sentences = text.split(/[。！!？?；;\n]/).filter(Boolean);
  for (const item of contexts) {
    const registered = [
      item.properties.material,
      item.properties.dimensions,
      item.properties.care,
      item.properties.power,
      ...item.properties.capabilities,
    ]
      .filter(Boolean)
      .join(" ");
    const official = item.officialFacts.map((f) => f.text).join(" ");
    const evidence = (registered + " " + official)
      .split(/[，,。；;\n]/)
      .filter(
        (s) =>
          !/未知|待确认|未确认|不详|不能|不支持|不可|禁止|不适用|不承重|不加热|不防水/.test(
            s,
          ),
      )
      .join(" ");
    const relevant = (s: string) =>
      s.includes(item.name) ||
      contexts.length === 1 ||
      (/杯|碗|容器|餐盒/.test(item.name) &&
        /杯|饮水|温水|热水|喝|食品|食物/.test(s));
    for (const sentence of sentences.filter(relevant)) {
      // A condition must precede the action in the same sentence; a trailing disclaimer does not license it.
      const prerequisite = (
        sentence.match(
          /^(?:[^，,：]{0,15}：)?\s*(?:如果|若|只有|先确认|确认)([^，,。；;\n]{0,70})/,
        )?.[1] || ""
      ).split(/才|之后|后|再|就|则/)[0];
      const conditionalFor = (property: RegExp) =>
        !!prerequisite && property.test(prerequisite);
      // Clause-scoped uncertainty must not suppress a later independent affirmative action.
      const positive = sentence
        .split(/[，,]|(?=但是|不过|但)/)
        .filter(
          (clause) =>
            !/未注明|未标明|未标注|未登记|尚未确认|未确认|尚未验证|未经确认|未知|没有被确认|没有依据|没有证据|没有官方资料|无法.{0,14}(?:判断|确定|确认)|不能确定|是否|能否|不等同|取决于|缺少|缺乏|(?:如需|若需|如果需要).{0,15}(?:使用|用于|盛装)/.test(
              clause,
            ),
        )
        .join("，")
        .replace(
          /(?:不要|不能|禁止|切勿|请勿|避免|不建议|不保证|不依赖|不加热|没有证据|未经证实|未确认|尚未确认|不能确认|无法确认)[^，,。；;\n]{0,100}/g,
          "",
        );
      if (
        !conditionalFor(/可用|修复|完好/) &&
        !item.usable &&
        /(?:可以|能够|能|请|直接|先|建议)(?:立即|继续|直接|先)?(?:使用|打开|通电|启动|倒入|承重|挂上|装入)|先用.{0,25}(?:照明|通电|承重)/.test(
          positive,
        )
      )
        issues.push(`${item.name}：当前不可用，不能建议直接使用`);
      if (
        /安心使用|放心使用|安全饮用|绝对安全|完全安全|保证.{0,6}(?:安全|可行)|一定.{0,6}(?:可行|成功)/.test(
          positive,
        )
      )
        issues.push(`${item.name}：不能保证未经验证的适用性或效果`);
      if (
        !conditionalFor(/食品接触|食品级|可接触食品/) &&
        /(?:喝|饮用|盛装|倒入|装入|承装|盛放).{0,12}(?:水|饮料|食品|食物)|装(?:点|些|一点)?(?:温水|热水|沸水|水|食物|饮料)|(?:温水|热水).{0,10}(?:喝|饮用)/.test(
          positive,
        ) &&
        /杯|碗|容器|餐盒/.test(item.name) &&
        !/食品接触(?:适用|已确认)|食品级(?:已确认)?|可接触食品/.test(evidence)
      )
        issues.push(
          `${item.name}：食品接触适用性未确认，不能直接建议饮用或盛食`,
        );
      if (
        !conditionalFor(/耐热|可加热|允许加热/) &&
        /(?:加热|盛装热水|装热水|装沸水|烤箱|耐热\s*\d)/.test(positive) &&
        !/耐热.{0,8}\d|可盛(?:装)?热水|允许加热/.test(evidence)
      )
        issues.push(`${item.name}：耐热或加热能力缺少依据`);
      for (const property of [
        "304",
        "316",
        "食品级",
        "镜面",
        "抛光",
        "杯底弧面",
        "凹槽",
        "透明",
        "防水",
        "承重",
      ]) {
        if (
          !conditionalFor(new RegExp(property)) &&
          positive.includes(property) &&
          !evidence.includes(property) &&
          !new RegExp(
            `(?:未知|未确认|不确定|不能确认|没有依据).{0,20}${property}|${property}.{0,15}(?:未知|未确认|待确认|不能确定|没有依据|需要核对)`,
          ).test(sentence)
        )
          issues.push(
            `${item.name}：${property}尚未确认，缺少当前属性或事实依据`,
          );
      }
      if (
        /热水|加热/.test(positive) &&
        /不(?:能|可|要|得).{0,8}(?:加热|热水)|仅.{0,8}常温/.test(registered)
      )
        issues.push(`${item.name}：建议与登记的温度限制冲突`);
      if (
        !conditionalFor(/光学|成像|透镜|放大|镜面|弧面/) &&
        /杯/.test(item.name) &&
        !/光学|成像|透镜|放大/.test(evidence) &&
        /(?:将|把|用|利用|让|使).{0,30}(?:杯底|弧面).{0,35}(?:文字|成像|放大|反射|透镜)/.test(
          positive,
        )
      )
        issues.push(
          `${item.name}：杯底几何与光学条件尚未确认，不能作为成像或放大步骤的依据`,
        );
      if (
        /微弱共振.{0,8}(?:反馈|放大)|(?:鼠标|杯底).{0,20}(?:自然留痕|自然留印|摩擦.{0,6}(?:灰痕|轨迹))/.test(
          positive,
        )
      )
        issues.push(`${item.name}：物理机制缺少可核对依据`);
    }
  }
  return [...new Set(issues)];
}
