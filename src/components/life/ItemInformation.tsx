"use client";
import { useEffect, useState } from "react";
import type { Item, Person } from "@/lib/domain";
import type { ProductPack } from "@/lib/products";
import type { Fragment } from "./Stories";
export function ItemInformation({
  item,
  actor,
  packs,
  request,
  upload,
  act,
  fragments,
  refresh,
}: {
  item: Item;
  actor: Person;
  packs: ProductPack[];
  request: any;
  upload: any;
  act: any;
  fragments: Fragment[];
  refresh: any;
}) {
  const [sources, setSources] = useState<any[]>([]),
    [notice, setNotice] = useState(""),
    [sourceText, setSourceText] = useState(""),
    [sourceTitle, setSourceTitle] = useState(""),
    [gift, setGift] = useState(false),
    [giftText, setGiftText] = useState(""),
    [chosen, setChosen] = useState<string[]>([]),
    [packId, setPack] = useState(item.productBinding?.packId || "");
  useEffect(() => {
    fetch(`/api/life?itemId=${encodeURIComponent(item.id)}`, {
      headers: { "x-demo-actor": actor },
    })
      .then((r) => r.json())
      .then((d) => setSources(d.sources || []))
      .catch((e) => setNotice(e.message));
  }, [item.id, actor]);
  const pack = packs.find((p) => p.id === item.productBinding?.packId);
  async function run(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  return (
    <div className="life-home-pair">
      <section className="life-card">
        <h2>物品资料与属性</h2>
        <dl>
          <dt>数量</dt>
          <dd>{item.attributes?.quantity ?? "未知"}</dd>
          <dt>材质 / 尺寸</dt>
          <dd>
            {item.attributes?.material || "未登记"} /{" "}
            {item.attributes?.dimensions || "未登记"}
          </dd>
          <dt>供电 / 维护</dt>
          <dd>
            {item.attributes?.power || "未登记"} /{" "}
            {item.attributes?.care || "未登记"}
          </dd>
          <dt>保质期</dt>
          <dd>{item.attributes?.expiresOn || "未登记"}</dd>
        </dl>
        {pack ? (
          <>
            <h3>{pack.product}</h3>
            <p>
              资料包 {pack.version} · {pack.source.section}
            </p>
            {pack.claims.map((f) => (
              <p key={f.id}>{f.text}</p>
            ))}
            <a href={pack.source.url} target="_blank" rel="noreferrer">
              打开原始官方来源 ↗
            </a>
            <p className="life-muted">{pack.limits.join(" ")}</p>
          </>
        ) : (
          <p>尚无已确认的型号资料包，不推断官方参数。</p>
        )}
        {item.owner === actor && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                if (packId) {
                  await act("bindProduct", {
                    itemId: item.id,
                    packId,
                    confirmed: true,
                  });
                  setNotice("资料包已按本人确认绑定");
                }
              });
            }}
          >
            <label>
              核对后绑定型号
              <select value={packId} onChange={(e) => setPack(e.target.value)}>
                <option value="">选择资料包</option>
                {packs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.product} · {p.model}
                  </option>
                ))}
              </select>
            </label>
            <label className="life-check">
              <input required type="checkbox" />
              我已核对具体实物与型号、地区版本
            </label>
            <button>确认绑定</button>
          </form>
        )}
      </section>
      <section className="life-card">
        <h2>我提供的说明书 / 经验</h2>
        {sources.map((s) => (
          <details key={s.id}>
            <summary>{s.title} · 用户资料</summary>
            <p className="life-source-excerpt">{s.text}</p>
            {s.url && (
              <a href={s.url} target="_blank" rel="noreferrer">
                查看来源 ↗
              </a>
            )}
          </details>
        ))}
        {item.owner === actor && (
          <>
            <label>
              上传说明书
              <input
                type="file"
                accept=".pdf,.txt,.md"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f)
                    run(async () => {
                      const d = await upload(f, "manual");
                      setSourceTitle(d.title);
                      setSourceText(d.text);
                      setNotice(d.notice);
                    });
                }}
              />
            </label>
            <label>
              标题
              <input
                value={sourceTitle}
                onChange={(e) => setSourceTitle(e.target.value)}
              />
            </label>
            <label>
              说明书原文或获准使用的经验
              <textarea
                maxLength={40000}
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
              />
            </label>
            <button
              disabled={!sourceText.trim()}
              onClick={() =>
                run(async () => {
                  await request("source", {
                    itemId: item.id,
                    title: sourceTitle || "用户资料",
                    text: sourceText,
                    kind: "user-text",
                  });
                  setSources([
                    ...sources,
                    {
                      id: crypto.randomUUID(),
                      title: sourceTitle,
                      text: sourceText,
                    },
                  ]);
                  setSourceText("");
                  setNotice("资料已保存，不自动认证为官方说明。");
                })
              }
            >
              保存这份资料
            </button>
          </>
        )}
        {item.owner === actor && (
          <>
            <hr />
            <h2>让物品带着选中的心意出发</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setGift(true);
              }}
            >
              <label>
                给收礼人的话
                <textarea
                  required
                  value={giftText}
                  onChange={(e) => setGiftText(e.target.value)}
                  maxLength={1000}
                />
              </label>
              {fragments
                .filter((f) => f.itemIds.includes(item.id))
                .map((f) => (
                  <label className="life-check" key={f.id}>
                    <input
                      type="checkbox"
                      checked={chosen.includes(f.id)}
                      onChange={(e) =>
                        setChosen(
                          e.target.checked
                            ? [...chosen, f.id]
                            : chosen.filter((id) => id !== f.id),
                        )
                      }
                    />
                    {f.text.slice(0, 90)}
                  </label>
                ))}
              <button>预览礼物与所选故事</button>
            </form>
            {gift && (
              <div className="life-notice">
                <strong>将赠送：{item.name}</strong>
                <p>{giftText}</p>
                <p>
                  只携带 {chosen.length}{" "}
                  条选中文字快照，不携带照片、聊天、画像和收礼后的私人记录。
                </p>
                <button
                  className="button"
                  onClick={() =>
                    run(async () => {
                      await request("gift", {
                        itemId: item.id,
                        fragmentIds: chosen,
                        message: giftText,
                      });
                      await refresh();
                      setGift(false);
                      setNotice(
                        "礼物已制作，在家庭与礼物中打开预览。尚未转移实物归属。",
                      );
                    })
                  }
                >
                  确认制作礼物
                </button>
                <button onClick={() => setGift(false)}>返回修改</button>
              </div>
            )}
          </>
        )}
        {notice && <p role="status">{notice}</p>}
      </section>
    </div>
  );
}
