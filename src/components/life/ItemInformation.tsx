"use client";
import { OfficialSources } from "./OfficialSources";
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
    [sourceLink, setSourceLink] = useState<string | undefined>(),
    [sourceKind, setSourceKind] = useState("user-text"),
    [busy, setBusy] = useState(false),
    [gift, setGift] = useState(false),
    [giftText, setGiftText] = useState(""),
    [chosen, setChosen] = useState<string[]>([]),
    [packId, setPack] = useState(item.productBinding?.packId || "");
  const [ocr, setOCR] = useState(false),
    [officialDraft, setOfficialDraft] = useState<any>(null);
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
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
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
        {item.owner === actor && (
          <details>
            <summary>更新数量、有效期和养护信息</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                run(async () => {
                  await request("updateItem", {
                    itemId: item.id,
                    brand: f.get("brand"),
                    model: f.get("model"),
                    lifecycle: f.get("lifecycle"),
                    attributes: {
                      ...item.attributes,
                      quantity:
                        f.get("quantity") !== ""
                          ? Number(f.get("quantity"))
                          : undefined,
                      expiresOn: f.get("expiresOn"),
                      material: f.get("material"),
                      care: f.get("care"),
                    },
                  });
                  await refresh();
                  setNotice(
                    "已更新管理信息；数量为零或过期的食品不参与创意候选。",
                  );
                });
              }}
            >
              <div className="life-form-row">
                <label>
                  品牌
                  <input
                    name="brand"
                    maxLength={80}
                    defaultValue={item.brand || ""}
                  />
                </label>
                <label>
                  具体型号
                  <input
                    name="model"
                    maxLength={100}
                    defaultValue={item.model || ""}
                  />
                </label>
              </div>
              <label>
                生命周期
                <select
                  name="lifecycle"
                  defaultValue={item.lifecycle || "长期耐用"}
                >
                  {[
                    "一次性",
                    "消耗型",
                    "可重复使用",
                    "长期耐用",
                    "持续养护",
                  ].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                当前数量
                <input
                  name="quantity"
                  type="number"
                  min="0"
                  step="0.1"
                  defaultValue={item.attributes?.quantity ?? ""}
                />
              </label>
              <label>
                保质期 / 有效期
                <input
                  type="date"
                  name="expiresOn"
                  defaultValue={item.attributes?.expiresOn || ""}
                />
              </label>
              <label>
                材质
                <input
                  name="material"
                  defaultValue={item.attributes?.material || ""}
                />
              </label>
              <label>
                {item.category === "植物"
                  ? "已确认的养护要求"
                  : item.category === "服装"
                    ? "实物洗护标签"
                    : "维护注意事项"}
                <textarea
                  name="care"
                  defaultValue={item.attributes?.care || ""}
                />
              </label>
              <button>保存管理信息</button>
            </form>
          </details>
        )}
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
            {item.owner === actor && (
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const d = await request("fetchSource", {
                      url: pack.source.url,
                    });
                    setSourceTitle(pack.source.title);
                    setSourceText(d.text);
                    setSourceLink(pack.source.url);
                    setSourceKind("user-link");
                    setNotice(
                      "已主动读取绑定来源的公开正文，请核对相关章节后保存；网页内容不会自动升级为已验证Product Pack事实。读取失败可上传说明书或补充原文。",
                    );
                  })
                }
              >
                读取这份公开来源的正文
              </button>
            )}
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
        {item.owner === actor && (
          <OfficialSources
            brand={item.brand || ""}
            model={item.model || ""}
            request={request}
            onChoose={(d) => setOfficialDraft(d)}
          />
        )}
        {officialDraft && (
          <form
            className="life-notice"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const d = await request("importOfficial", {
                  itemId: item.id,
                  url: officialDraft.url,
                  confirmed: true,
                });
                setSources((rows) => [
                  d.source,
                  ...rows.filter((s) => s.id !== d.source.id),
                ]);
                setOfficialDraft(null);
                setNotice(d.notice);
              });
            }}
          >
            <strong>{officialDraft.title}</strong>
            <label className="life-check">
              <input type="checkbox" required />
              我已核对实物完整型号、地区及资料适用性
            </label>
            <button disabled={busy}>确认保存官方摘录</button>
            <button type="button" onClick={() => setOfficialDraft(null)}>
              取消
            </button>
          </form>
        )}
        {sources.map((s) => (
          <details key={s.id}>
            <summary>
              {s.title} ·{" "}
              {s.kind === "official-public" ? "官方站点摘录" : "用户资料"}
            </summary>
            {s.knowledge && (
              <>
                <p className="life-muted">
                  档案型号：{s.knowledge.applicableModel} ·{" "}
                  {s.knowledge.modelInDocument
                    ? "原文有型号文字"
                    : "原文未匹配完整型号"}{" "}
                  · {s.knowledge.provenance}
                </p>
                {s.knowledge.sections.map((k: any) => (
                  <blockquote key={k.id}>
                    <small>
                      {k.category} · 原文位置 {k.start}–{k.end}
                    </small>
                    <p>{k.quote}</p>
                  </blockquote>
                ))}
              </>
            )}
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
                accept=".pdf,.txt,.md,.jpg,.jpeg,.png,.webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f)
                    run(async () => {
                      const d = await upload(f, ocr ? "manual-ocr" : "manual");
                      setSourceTitle(d.title);
                      setSourceText(d.text);
                      setSourceLink(undefined);
                      setSourceKind("user-manual");
                      setNotice(d.notice);
                    });
                }}
              />
            </label>
            <label className="life-check">
              <input
                type="checkbox"
                checked={ocr}
                onChange={(e) => setOCR(e.target.checked)}
              />
              本机 OCR：图片或扫描 PDF 前3页（请核对文字与数字）
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
                aria-label="说明书原文或获准使用的经验"
                maxLength={40000}
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
              />
            </label>
            <button
              disabled={busy || !sourceText.trim()}
              onClick={() =>
                run(async () => {
                  const saved = await request("source", {
                    itemId: item.id,
                    title: sourceTitle || "用户资料",
                    text: sourceText,
                    kind: sourceKind,
                    url: sourceLink,
                  });
                  setSources([
                    ...sources.filter((s) => s.id !== saved.id),
                    {
                      id: saved.id,
                      title: sourceTitle,
                      text: sourceText,
                      url: sourceLink,
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
                        "礼物已制作，在社交中打开预览。尚未转移实物归属。",
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
