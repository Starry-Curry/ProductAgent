"use client";
import { useState } from "react";
import type { Item } from "@/lib/domain";
export function HelpEntry({
  items,
  onAsk,
  elder = false,
}: {
  items: Item[];
  onAsk: (itemId: string, question: string) => void;
  elder?: boolean;
}) {
  const [itemId, setItemId] = useState("");
  const [question, setQuestion] = useState("");
  return (
    <section className="help-hero">
      <div className="help-intro">
        <span className="eyebrow">物品使用帮助</span>
        <h1>{elder ? "不会用？在这里问。" : "东西不会用，先问一问。"}</h1>
        <p>
          {elder
            ? "选一件东西，写下遇到的问题。"
            : "说明书找不到、按钮看不懂、出了小故障，都从这里开始。"}
        </p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onAsk(itemId, question);
        }}
      >
        <label>
          你想问哪件东西？
          <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">还没保存的物品 / 不确定</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          遇到什么问题？
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            required
            maxLength={2000}
            placeholder="例如：电饭煲怎么预约煮饭？"
          />
        </label>
        <button className="button">帮我解决</button>
        <small>回答不了时，可以继续找家人或联系售后。</small>
      </form>
    </section>
  );
}
