"use client";
import { useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  LampDesk,
  Frame,
  Package,
  Speaker,
  Flower2,
  Heart,
  RefreshCw,
} from "lucide-react";
import type { Item } from "@/lib/domain";
import { apartmentProducts } from "@/lib/catalog/virtual-apartment";

export type HomeKnowledge = {
  itemId: string;
  model?: string;
  status: string;
  at?: string;
  issues: string[];
  reviewedPack?: {
    source: { title: string; url: string; checkedAt: string };
    facts: { id: string; text: string }[];
  };
  documents: {
    id: string;
    title: string;
    url: string;
    fetchedAt: string;
    role?: string;
    applicability?: string;
    excerpt?: string;
  }[];
};
export type VirtualHomeData = {
  id: string;
  itemIds: string[];
  allowCloud: boolean;
  knowledge: HomeKnowledge[];
};
export const homeJourneys = [
  {
    title: "今晚，写一页旅行手账",
    text: "今晚想在书桌上写旅行手账，帮我把桌面安排舒服一点。我喜欢安静，不想再买东西。",
    label: "灯光 · 桌面 · 我的习惯",
  },
  {
    title: "给那幅画，找一个新位置",
    text: "这幅画是谁送我的？我现在想把它和桌上的其他东西重新布置一下，你帮我一起想想。",
    label: "物品 · 故事 · 一起安排",
  },
  {
    title: "把台灯，用得更顺手",
    text: "米家台灯1S MJTD01SYL怎样调亮度和色温？怎么连接家里的网络，连接不上时先检查什么？",
    label: "真实型号 · 官方说明",
  },
];
const icons = [
  LampDesk,
  Package,
  Package,
  Package,
  Speaker,
  Heart,
  Flower2,
  Frame,
];
export function HomeSources({ knowledge }: { knowledge: HomeKnowledge }) {
  return (
    <details className="home-sources">
      <summary>
        {knowledge.status === "live-read"
          ? "已实际读取官网"
          : knowledge.status === "cached-fallback"
            ? "本次失败，使用已有资料缓存"
            : knowledge.status === "unavailable"
              ? "本次未能读取官网"
              : "尚未联网获取"}{" "}
        · {knowledge.documents.length} 份资料
      </summary>
      <p>
        商品资料说明这个型号；个人状态与私人经历来自模拟设定。读取成功也不等于已核对所有规格或验证实物。
      </p>
      {knowledge.documents.map((d) => (
        <div key={d.id}>
          <a href={d.url} target="_blank" rel="noreferrer">
            {d.role === "manual" ? "说明书" : "官方页面"} · {d.title} ↗
          </a>
          <small>
            {d.applicability} ·{" "}
            {new Date(d.fetchedAt).toLocaleDateString("zh-CN")}
          </small>
          {d.excerpt && <blockquote>{d.excerpt}…</blockquote>}
        </div>
      ))}
      {knowledge.reviewedPack && (
        <div>
          <strong>已有审核资料缓存 · 非本次联网结果</strong>
          <ul>
            {knowledge.reviewedPack.facts.map((f) => (
              <li key={f.id}>{f.text}</li>
            ))}
          </ul>
          <a
            href={knowledge.reviewedPack.source.url}
            target="_blank"
            rel="noreferrer"
          >
            {knowledge.reviewedPack.source.title} ↗
          </a>
          <small>缓存核对日期：{knowledge.reviewedPack.source.checkedAt}</small>
        </div>
      )}
      {knowledge.issues.length > 0 && (
        <p className="home-source-warning">
          部分获取未完成：{[...new Set(knowledge.issues)].join("；")}
        </p>
      )}
    </details>
  );
}
export function VirtualHome({
  data,
  items,
  active,
  onActive,
  request,
  refresh,
  onAsk,
  onItem,
  goalEntry,
}: {
  data: VirtualHomeData;
  items: Item[];
  active: boolean;
  onActive: (value: boolean) => void;
  request: (action: string, input?: unknown) => Promise<any>;
  refresh: () => Promise<void>;
  onAsk: (text: string) => void;
  onItem: (id: string) => void;
  goalEntry?: ReactNode;
}) {
  const [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState("");
  const installed = data.itemIds.length === 8;
  async function fetchKnowledge() {
    for (let n = 0; n < apartmentProducts.length; n++) {
      const p = apartmentProducts[n];
      setProgress(`正在认识 ${p.name}（${n + 1}/7）`);
      try {
        await request("refreshHomeProduct", { key: p.key });
      } catch (e) {
        setError((e as Error).message);
      }
      await refresh();
    }
    setProgress("本轮官网获取完成。打不开的来源会保留真实失败提示。");
  }
  return (
    <section className="apartment" aria-label="虚拟年轻人公寓">
      <div className="apartment-intro">
        <div>
          <span className="life-eyebrow">
            A LITTLE HOME, A SHARED UNDERSTANDING
          </span>
          <h1>
            让手边的物品，
            <br />
            回应你的生活。
          </h1>
          <p>
            一盏灯、一张书桌，还有朋友送的画。
            <br />
            让物间把物品、习惯和故事放在同一个生活目标里。
          </p>
        </div>
        <div className="apartment-seal">
          <span>虚拟年轻人公寓</span>
          <strong>
            7 款真实商品
            <br />1 件模拟纪念物
          </strong>
          <small>
            持有、位置与私人经历均为模拟
            <br />
            图标是占位，非商品实拍
          </small>
        </div>
      </div>
      {!installed ? (
        <div className="apartment-install">
          <p>
            一键加入这套独立标记的模拟家庭，不更改已有物品。朋友小夏赠画、安静写手账等是公开的测试设定，不是你的真实经历。
          </p>
          <label>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            允许云端模型使用这套模拟家庭的物品、位置、偏好及赠画故事来完成任务。不会授权已有私人资料。
          </label>
          <button
            className="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await request("loadVirtualHome", {
                  confirmed: true,
                  allowCloud: consent,
                });
                onActive(true);
                await refresh();
                await fetchKnowledge();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "正在打开这个家…" : "打开模拟家庭"}
            <ArrowUpRight size={17} />
          </button>
        </div>
      ) : (
        <>
          <div className="apartment-toolbar">
            <span className="apartment-status">
              {active ? "正在模拟家庭中" : "模拟家庭已保留"}
            </span>
            <button onClick={() => onActive(!active)}>
              {active ? "切回原有物品空间" : "进入模拟家庭"}
            </button>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await fetchKnowledge();
                } finally {
                  setBusy(false);
                }
              }}
            >
              <RefreshCw size={14} />
              重新获取官网资料
            </button>
          </div>
          {active && (
            <>
              {goalEntry}
              <div className="apartment-journeys">
                {homeJourneys.map((j, n) => (
                  <button
                    key={j.title}
                    disabled={busy}
                    onClick={() => onAsk(j.text)}
                  >
                    <small>
                      0{n + 1} / {j.label}
                    </small>
                    <h2>{j.title}</h2>
                    <span>
                      从这个生活目标开始 <ArrowUpRight size={17} />
                    </span>
                  </button>
                ))}
              </div>
              <label className="apartment-consent">
                <input
                  type="checkbox"
                  checked={data.allowCloud}
                  disabled={busy}
                  onChange={async (e) => {
                    const value = e.target.checked;
                    setBusy(true);
                    try {
                      await request("setVirtualHomeCloud", {
                        allowCloud: value,
                      });
                      await refresh();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
                允许模拟家庭任务使用云端模型。单条记忆仍遵守自己的授权，可在物品详情中纠正、遗忘或关闭。
              </label>
              <div className="apartment-items">
                {items
                  .filter((i) => data.itemIds.includes(i.id))
                  .map((i, n) => {
                    const Icon = icons[n] || Package;
                    const knowledge = data.knowledge.find(
                      (k) => k.itemId === i.id,
                    );
                    return (
                      <article key={i.id}>
                        <button
                          className="apartment-item"
                          onClick={() => onItem(i.id)}
                        >
                          <span className="apartment-object">
                            {i.photo?.startsWith("/virtual-home/") ? (
                              <img
                                src={i.photo}
                                alt="模拟原创画作，非真实照片"
                              />
                            ) : (
                              <Icon size={38} strokeWidth={1.2} />
                            )}
                          </span>
                          <div>
                            <small>
                              {i.brand} · {i.model}
                            </small>
                            <h3>{i.name}</h3>
                            <p>{i.location}</p>
                            <span>了解它与我的故事 ↗</span>
                          </div>
                        </button>
                        {knowledge && i.model !== "无商品型号" && (
                          <HomeSources knowledge={knowledge} />
                        )}
                      </article>
                    );
                  })}
              </div>
            </>
          )}
        </>
      )}
      {progress && (
        <p role="status" className="apartment-progress">
          {progress}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
