"use client";
import { useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ExternalLink,
  Package,
  Search,
  Leaf,
  Speaker,
} from "lucide-react";
import type { Item } from "@/lib/domain";
import type { ProductPack } from "@/lib/products";
import type { LifeRequest } from "./Intake";

export function ProductArrival({
  request,
  upload,
  onSaved,
  children,
}: {
  request: LifeRequest;
  upload: (
    file: File,
    kind: "photo" | "story-photo",
  ) => Promise<{ id: string; url: string }>;
  onSaved: (item: Item) => Promise<void>;
  children: React.ReactNode;
}) {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<
      {
        pack: ProductPack;
        retrieval: {
          status: string;
          message: string;
          checkedAt: string;
          manuals: { title: string; url: string }[];
        };
      }[]
    >([]);
  const [selected, setSelected] = useState<ProductPack>(),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [photo, setPhoto] = useState<{ id: string; url: string }>();
  const requestId = useRef(crypto.randomUUID());
  async function lookup(q: string, refresh = false) {
    setBusy(true);
    setSelected(undefined);
    try {
      const d = await request("recognizeProduct", { query: q, refresh });
      setResults(d.products);
      setMessage(d.message);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="belong-arrival">
      <header className="belong-heading">
        <span className="belong-kicker">A NEW CHAPTER · 认识一件物品</span>
        <h1>
          从一件商品，
          <br />
          到你的生活里。
        </h1>
        <p>先认识它是什么，再慢慢认识它为什么属于你。</p>
      </header>
      <form
        className="belong-search"
        onSubmit={(e) => {
          e.preventDefault();
          lookup(query, true);
        }}
      >
        <Search size={22} />
        <input
          aria-label="商品名称、型号或官方链接"
          placeholder="商品名称、型号，或官方商品链接"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          required
        />
        <button disabled={busy}>
          {busy ? "正在认识…" : "认识它"}
          <ArrowRight size={18} />
        </button>
      </form>
      <div className="belong-suggestions">
        从已核对的商品开始{" "}
        <button onClick={() => lookup("SAMLA")}>SAMLA 储物盒</button>
        <button onClick={() => lookup("KNAGGLIG")}>KNAGGLIG 木盒</button>
        <button onClick={() => lookup("GO 4")}>JBL GO 4</button>
      </div>
      {message && (
        <p role="status" className="belong-notice">
          {message}
        </p>
      )}
      <div className="belong-product-grid">
        {results.map(({ pack, retrieval }) => (
          <article
            key={pack.id}
            className={
              "belong-product " +
              (selected?.id === pack.id ? "is-selected" : "")
            }
          >
            <div className="belong-product-art">
              {pack.id.includes("jbl") ? (
                <Speaker size={70} />
              ) : pack.id.includes("knagglig") ? (
                <Leaf size={70} />
              ) : (
                <Package size={70} />
              )}
              <span>型号资料 · 非持有记录</span>
            </div>
            <div className="belong-product-copy">
              <span className="belong-kicker">{pack.model}</span>
              <h2>{pack.product}</h2>
              <ul>
                {pack.claims.map((c) => (
                  <li key={c.id}>{c.text}</li>
                ))}
              </ul>
              <details>
                <summary>使用限制与未知项</summary>
                {pack.limits.map((l) => (
                  <p key={l}>{l}</p>
                ))}
              </details>
              <p className="belong-source">
                {retrieval.message}
                <br />
                资料核对：{retrieval.checkedAt}
              </p>
              <a href={pack.source.url} target="_blank" rel="noreferrer">
                查看官方依据 <ExternalLink size={13} />
              </a>
              {retrieval.manuals.map((m) => (
                <a key={m.url} href={m.url} target="_blank" rel="noreferrer">
                  {m.title || "说明书"}
                </a>
              ))}
              <button
                className="belong-primary"
                onClick={() => {
                  setSelected(pack);
                  requestId.current = crypto.randomUUID();
                  setPhoto(undefined);
                }}
              >
                是这个型号，继续 <ArrowRight size={16} />
              </button>
            </div>
          </article>
        ))}
      </div>
      {selected && (
        <form
          key={selected.id}
          className="belong-claim"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            try {
              const d = await request("createItem", {
                requestId: requestId.current,
                name: String(f.get("name")),
                brand: selected.id.includes("jbl") ? "JBL" : "IKEA",
                model: selected.model,
                region: selected.id.includes("jbl") ? undefined : "cn",
                category: selected.id.includes("jbl") ? "音箱" : "收纳用品",
                lifecycle: "长期耐用",
                availability: f.get("available") ? "available" : "unknown",
                packId: selected.id,
                confirmed: f.get("modelConfirmed") === "on",
                ownsConfirmed: f.get("owns") === "on",
                synthetic: f.get("synthetic") === "on",
                location: String(f.get("location")),
                note: String(f.get("note")),
                mediaId: photo?.id,
              });
              await onSaved(d.item);
            } catch (err) {
              setMessage((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <span className="belong-kicker">第二步 · 你的这一件</span>
          <h2>相同的型号，不同的生活。</h2>
          <p>官方资料只描述商品设计。使用状态、位置与经历，由你来告诉物间。</p>
          <div className="belong-fields">
            <label>
              给它一个自己的名字
              <input
                name="name"
                required
                maxLength={80}
                defaultValue={selected.product}
              />
            </label>
            <label>
              现在放在哪里
              <input
                name="location"
                maxLength={80}
                placeholder="例如，书桌右手边"
              />
            </label>
            <label className="wide">
              我的状态与备注
              <textarea
                name="note"
                maxLength={1500}
                placeholder="例如，盖子完好，目前放着我的旅行纪念品。未填写的状态保持未知。"
              />
            </label>
            <label>
              它在生活里的照片
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setBusy(true);
                  try {
                    setPhoto(await upload(f, "photo"));
                  } catch (err) {
                    setMessage((err as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </label>
            {photo && (
              <img
                className="belong-photo-thumb"
                src={photo.url}
                alt="我的物品照片"
              />
            )}
          </div>
          <label className="belong-check">
            <input name="modelConfirmed" type="checkbox" required />
            我已核对，实物型号与这份资料一致
          </label>
          <label className="belong-check">
            <input name="owns" type="checkbox" required />
            我确认拥有这件物品（体验测试时表示合成持有）
          </label>
          <label className="belong-check">
            <input name="available" type="checkbox" />
            我确认它现在在手且可用
          </label>
          <label className="belong-check">
            <input name="synthetic" type="checkbox" />
            这是体验用测试物品，不代表真实持有
          </label>
          <button className="belong-primary" disabled={busy}>
            <Check size={18} />
            {busy ? "保存中…" : "让它成为我的物品"}
          </button>
        </form>
      )}
      <details className="belong-manual">
        <summary>录入其他真实商品、说明书或自己的纪念物</summary>
        {children}
      </details>
    </section>
  );
}
