"use client";
import { useState } from "react";
import type { Item } from "@/lib/domain";
export function HouseholdCases({
  items,
  onOpen,
}: {
  items: Item[];
  onOpen: (item: Item, tab: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const examples = items.filter((i) => i.demo);
  if (!examples.length) return null;
  const preview = [...examples.slice(0, 2), ...examples.slice(4, 6)];
  const shown = expanded ? examples : preview;
  return (
    <details className="panel household-cases" open>
      <summary>从一个家居生活案例开始 · {examples.length} 个示例</summary>
      <p>
        商品信息来自已核对的官方地区页面；故事、关系和事项为合成案例，与你的真实记忆分开。以小林角色可体验完整案例故事。
      </p>
      <div className="case-grid">
        {shown.map((item) => (
          <article className="case-card" key={item.id}>
            <small>演示案例 · {item.category}</small>
            <h3>{item.demo!.title}</h3>
            <p>{item.name}</p>
            <small>{item.demo!.summary}</small>
            <div className="inline">
              <button
                className="button secondary"
                onClick={() => onOpen(item, "智能服务")}
              >
                查看资料与帮助
              </button>
              <button
                className="text-button"
                onClick={() => onOpen(item, "故事与记录")}
              >
                和它聊聊
              </button>
            </div>
          </article>
        ))}
      </div>
      {examples.length > 4 && (
        <button className="text-button" onClick={() => setExpanded(!expanded)}>
          {expanded ? "收起案例" : "查看全部 " + examples.length + " 个案例"}
        </button>
      )}
    </details>
  );
}
