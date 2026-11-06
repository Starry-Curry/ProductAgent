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
        <div className="example-questions">
          <span>不确定怎么开始？先填一个示例：</span>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setItemId("");
              setQuestion("Windows 11 双击速度怎么调");
            }}
          >
            试试分步帮助
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setItemId("");
              setQuestion("怎样把整理桌面拆成十分钟的小任务？");
            }}
          >
            试试 AI 一般帮助
          </button>
        </div>
        <small>
          示例只填入问题，点击“帮我解决”后才发送。分步帮助可离线体验，一般帮助需要已配置模型。
        </small>
        <button className="button">帮我解决</button>
        <small>回答不了时，可以继续找家人或联系售后。</small>
      </form>
    </section>
  );
}
