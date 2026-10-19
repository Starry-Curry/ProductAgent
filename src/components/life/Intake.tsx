"use client";
import { useState, useRef } from "react";
import type { Item } from "@/lib/domain";
import type { ProductPack } from "@/lib/products";
export type LifeRequest = (action: string, input?: unknown) => Promise<any>;
export function Intake({
  packs,
  request,
  upload,
  onSaved,
}: {
  packs: ProductPack[];
  request: LifeRequest;
  upload: (file: File, kind: string) => Promise<any>;
  onSaved: (item: Item) => void;
}) {
  const [name, setName] = useState(""),
    [brand, setBrand] = useState(""),
    [model, setModel] = useState(""),
    [packId, setPack] = useState(""),
    [category, setCategory] = useState("其他"),
    [cycle, setCycle] = useState("长期耐用"),
    [photo, setPhoto] = useState<{ id: string; url: string } | null>(null),
    [code, setCode] = useState(""),
    [url, setUrl] = useState(""),
    [source, setSource] = useState<any>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const requestId = useRef("");
  const [savedItem, setSavedItem] = useState<Item | null>(null);
  async function savePendingSource(item: Item) {
    try {
      if (source?.text?.trim())
        await request("source", {
          itemId: item.id,
          title: source.title || "用户提供的资料",
          text: source.text,
          url: source.url,
          kind: source.kind || "user-text",
        });
    } catch (e) {
      setNotice(
        `物品已成功建档，资料尚未保存：${(e as Error).message}。请修正资料后单独重试，无需再次录入。`,
      );
      return;
    }
    onSaved(item);
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function choose(id: string) {
    setPack(id);
    const p = packs.find((p) => p.id === id);
    if (p) {
      if (!name) setName(p.product);
      setModel(p.model);
      if (!brand) setBrand(p.product.split(" ")[0]);
    }
  }
  const suppliedText =
    `${model} ${url} ${source?.title || ""} ${source?.text || ""}`.toLowerCase();
  const extractedPacks = packs.filter((p) =>
    new RegExp(
      `(^|[^a-z0-9])${p.model
        .toLowerCase()
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\s+/g, "\\s*")}(?![a-z0-9])`,
    ).test(suppliedText),
  );
  return (
    <div className="life-intake">
      <div className="life-section-head">
        <div>
          <span className="life-eyebrow">BRING SOMETHING INTO YOUR LIFE</span>
          <h1>认识一件身边的物品</h1>
          <p>先录入你知道的，未知信息可以以后补充。</p>
        </div>
      </div>
      <div className="life-intake-grid">
        <section className="life-card">
          <h2>照片、编码或资料，都可以开始</h2>
          {photo ? (
            <img
              className="life-upload-preview"
              src={photo.url}
              alt="待录入物品"
            />
          ) : (
            <div className="life-upload-empty">留一张它现在的样子</div>
          )}
          <label className="life-file">
            上传物品照片
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f)
                  run(async () => {
                    const d = await upload(f, "photo");
                    setPhoto(d);
                    setNotice(d.notice);
                  });
              }}
            />
          </label>
          <p className="life-muted">
            当前视觉模型未启用。照片可真实保存，名称与型号由你核对；不会冒充识物成功。
          </p>
          <details>
            <summary>条形码 / 二维码</summary>
            <label>
              编码图片
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  run(async () => {
                    const { BrowserMultiFormatReader } =
                      await import("@zxing/browser");
                    const reader = new BrowserMultiFormatReader();
                    const u = URL.createObjectURL(f);
                    try {
                      const result = await reader.decodeFromImageUrl(u);
                      const text = result.getText();
                      setCode(text);
                      const d = await request("code", { text });
                      if (d.type === "url") setUrl(d.text);
                      setNotice(d.notice);
                    } finally {
                      URL.revokeObjectURL(u);
                    }
                  });
                }}
              />
            </label>
            <label>
              或粘贴已解码的原始内容
              <input value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
            <button
              type="button"
              disabled={busy || !code}
              onClick={() =>
                run(async () => {
                  const d = await request("code", { text: code });
                  if (d.type === "url") setUrl(d.text);
                  setNotice(d.notice);
                })
              }
            >
              解析实际内容
            </button>
            <p className="life-muted">
              编码不等于说明书；当前无通用条码商品数据库。
            </p>
          </details>
          <details>
            <summary>商品链接、公开资料或说明书</summary>
            <label>
              公开 HTTPS 链接
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
              />
            </label>
            <button
              type="button"
              disabled={busy || !url}
              onClick={() =>
                run(async () => {
                  const d = await request("fetchSource", { url });
                  setSource(d);
                  setNotice(d.notice);
                })
              }
            >
              主动读取这份公开资料
            </button>
            <label>
              上传说明书（PDF / TXT / MD，8MB 内）
              <input
                type="file"
                accept=".pdf,.txt,.md"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f)
                    run(async () => {
                      const d = await upload(f, "manual");
                      setSource(d);
                      setNotice(d.notice);
                    });
                }}
              />
            </label>
            <p className="life-muted">
              不会登录、绕过访问限制或抓取社区全站。读取失败可粘贴获准使用的文字。
            </p>
            <label>
              资料标题
              <input
                value={source?.title || ""}
                onChange={(e) =>
                  setSource({
                    ...source,
                    title: e.target.value,
                    kind: source?.kind || "user-text",
                  })
                }
              />
            </label>
            <label>
              资料原文
              <textarea
                aria-label="资料原文"
                value={source?.text || ""}
                maxLength={40000}
                onChange={(e) =>
                  setSource({
                    ...source,
                    text: e.target.value,
                    kind: source?.kind || "user-text",
                  })
                }
              />
            </label>
          </details>
        </section>
        <form
          className="life-card"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(async () => {
              if (savedItem) {
                await savePendingSource(savedItem);
                return;
              }
              if (!requestId.current) requestId.current = crypto.randomUUID();
              const d = await request("createItem", {
                requestId: requestId.current,
                name,
                brand,
                model: model || "待确认",
                category,
                lifecycle: cycle,
                availability: f.get("available") ? "available" : "unknown",
                mediaId: photo?.id,
                packId: packId || undefined,
                confirmed: f.get("confirmed") === "on",
                attributes: {
                  material: f.get("material"),
                  care: f.get("care"),
                  power: f.get("power"),
                  dimensions: f.get("dimensions"),
                  quantity:
                    f.get("quantity") !== ""
                      ? Number(f.get("quantity"))
                      : undefined,
                  expiresOn: f.get("expiresOn"),
                  capabilities: String(f.get("capabilities") || "")
                    .split(/[,，、]/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                },
              });
              setSavedItem(d.item);
              await savePendingSource(d.item);
            });
          }}
        >
          <h2>确认它的信息</h2>
          <p className="life-muted">
            先记下名称与照片就能开始。品牌、资料和能力可以稍后补充；未知信息不会自动变成已确认事实。
          </p>
          {extractedPacks.length > 0 && (
            <div className="life-notice">
              <p>
                提供的型号/链接/资料文本出现以下目录型号（文字匹配，未核验实物；不会自动绑定）：
              </p>
              {extractedPacks.map((p) => (
                <button type="button" key={p.id} onClick={() => choose(p.id)}>
                  采用候选：{p.product} · {p.model}
                </button>
              ))}
            </div>
          )}
          <label>
            物品名称
            <input
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：窗边的小台灯"
            />
          </label>
          <div className="life-form-row">
            <label>
              品牌
              <input
                maxLength={80}
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
              />
            </label>
            <label>
              具体型号
              <input
                maxLength={100}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="不确定可以留空"
              />
            </label>
          </div>
          <label>
            匹配已有可核验资料包
            <select value={packId} onChange={(e) => choose(e.target.value)}>
              <option value="">暂不绑定，保留未知</option>
              {packs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.product} · {p.model}
                </option>
              ))}
            </select>
          </label>
          {packId && (
            <label className="life-check">
              <input type="checkbox" name="confirmed" required />
              我已核对实物型号与页面地区版本，确认绑定该资料包
            </label>
          )}
          <div className="life-form-row">
            <label>
              类别
              <select
                aria-label="类别"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  if (e.target.value === "食品") setCycle("消耗型");
                  else if (e.target.value === "植物") setCycle("持续养护");
                  else if (e.target.value === "服装") setCycle("可重复使用");
                }}
              >
                {[
                  "电子设备",
                  "厨房用品",
                  "家具",
                  "服装",
                  "食品",
                  "植物",
                  "手工材料",
                  "出行用品",
                  "其他",
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              生命周期
              <select
                aria-label="生命周期"
                value={cycle}
                onChange={(e) => setCycle(e.target.value)}
              >
                {["一次性", "消耗型", "可重复使用", "长期耐用", "持续养护"].map(
                  (x) => (
                    <option key={x}>{x}</option>
                  ),
                )}
              </select>
            </label>
          </div>
          <div className="life-form-row">
            <label>
              数量
              <input
                name="quantity"
                type="number"
                min="0"
                max="100000"
                step="0.1"
              />
            </label>
            {(category === "食品" || cycle === "消耗型") && (
              <label>
                保质期 / 有效期
                <input name="expiresOn" type="date" />
              </label>
            )}
            <label>
              材质
              <input name="material" maxLength={100} />
            </label>
          </div>
          <details className="intake-extra">
            <summary>补充能力与维护信息（可稍后填写）</summary>
            <div className="life-form-row">
              <label>
                尺寸
                <input name="dimensions" maxLength={100} />
              </label>
              <label>
                供电方式
                <input name="power" maxLength={100} />
              </label>
            </div>
            <label>
              {category === "植物"
                ? "品种与养护要求（以可靠资料为准）"
                : category === "服装"
                  ? "洗护标签与注意事项"
                  : "维护与使用限制"}
              <textarea name="care" maxLength={500} />
            </label>
            <label>
              已确认的能力 / 功能（逗号分隔）
              <input name="capabilities" placeholder="例如：收纳、照明、便携" />
            </label>
          </details>
          <label className="life-check">
            <input name="available" type="checkbox" />
            我确认它目前在手、完好且可用
          </label>
          <button className="button" disabled={busy}>
            {busy
              ? "正在处理…"
              : savedItem
                ? "仅重试保存资料"
                : "确认并录入物品"}
          </button>
          {savedItem && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onSaved(savedItem)}
            >
              先查看已建档物品，稍后补资料
            </button>
          )}
        </form>
      </div>
      {notice && (
        <p className="life-notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
