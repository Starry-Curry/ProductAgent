"use client";
import { useState } from "react";
import type { Item, Person } from "@/lib/domain";
import type { Action } from "./FamilyTasks";
export function SellerSupport({
  item,
  actor,
  act,
  question = "",
}: {
  item?: Item;
  actor: Person;
  act?: Action;
  question?: string;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <details className="support-box">
      <summary>联系卖家 / 售后</summary>
      {item?.supportUrl ? (
        <>
          <p>这是物品所有者保存的售后地址，将打开外部页面。</p>
          <a
            className="button"
            href={item.supportUrl}
            target="_blank"
            rel="noreferrer"
          >
            打开售后页面 ↗
          </a>
        </>
      ) : (
        <p>
          还没有保存这件物品的售后入口。请打开购买平台的订单，选择“联系卖家”或“申请售后”；线下购买可查看发票、保修卡上的联系方式。
        </p>
      )}
      <p>当前不会自动转接客服，也不会自动发送你的问题。</p>
      <button
        className="button secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(
              `物品：${item?.name || "待补充"}\n型号：${item?.model || "待确认"}\n问题：${question || "请补充遇到的情况"}\n希望获得使用说明或售后协助。`,
            );
            setMessage("问题摘要已复制，可以自行发给卖家。");
          } catch {
            setMessage("复制失败，请手动复制问题后发给卖家。");
          }
        }}
      >
        复制问题给卖家
      </button>
      {item && item.owner === actor && act && (
        <details>
          <summary>保存 / 修改售后链接</summary>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const url = new FormData(e.currentTarget).get("supportUrl");
                if (
                  await act("updateItem", { itemId: item.id, supportUrl: url })
                )
                  setMessage("售后入口已保存");
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              售后页面链接
              <input
                name="supportUrl"
                type="url"
                defaultValue={item.supportUrl || ""}
                placeholder="https://…"
              />
            </label>
            <button className="button secondary" disabled={busy}>
              保存售后入口
            </button>
          </form>
        </details>
      )}
      {message && <p role="status">{message}</p>}
    </details>
  );
}
