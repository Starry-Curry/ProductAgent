import { ArrowUpRight, BookOpen, Search } from "lucide-react";
import type { Run } from "../api";

export default function CreativeSources({ run, guidance = false }: { run: Run | null; guidance?: boolean }) {
  const sources = new Map<
    string,
    { url: string; title: string; read: boolean }
  >();
  function add(url: unknown, title: unknown, read: boolean) {
    if (typeof url !== "string") return;
    try {
      const parsed = new URL(url);
      if (!["https:", "http:"].includes(parsed.protocol)) return;
      const previous = sources.get(url);
      if (!previous || read)
        sources.set(url, {
          url,
          title: String(title || parsed.hostname),
          read,
        });
    } catch {
      /* Invalid links are not displayed. */
    }
  }
  for (const event of run?.events || []) {
    if (event.type === "research_search" && Array.isArray(event.sources))
      for (const source of event.sources as { url?: string }[])
        add(source.url, "", false);
    if (event.type === "research_source") add(event.url, event.title, true);
  }
  const busy = run && ["queued", "running"].includes(run.status);
  return (
    <section className="creative-sources">
      <h2>
        <BookOpen size={21} />
        {guidance ? "这次查到的资料" : "参考的分享与资料"}
      </h2>
      <p className="muted">
        {guidance ? "搜索线索与已读取原文分别标记；还需核对型号、版本和当前条件。" : "搜索线索和已读取原文分别标记，结合这件物品的实际条件再看玩法。"}
      </p>
      {[...sources.values()]
        .sort((a, b) => Number(b.read) - Number(a.read))
        .map((source) => (
          <a
            className="creative-source"
            href={source.url}
            key={source.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span>{source.read ? "已读原文" : "搜索线索"}</span>
            <strong>{source.title}</strong>
            <small>
              {new URL(source.url).hostname}
              <ArrowUpRight size={15} />
            </small>
          </a>
        ))}
      {sources.size === 0 && (
        <div className="creative-source-empty">
          <Search size={26} strokeWidth={1.2} />
          <p>
            {busy
              ? guidance ? "正在核对型号和查找适用资料…" : "正在查找与这次想法相关的公开分享…"
              : run
                ? guidance ? "本轮暂未取得可核对的原文，已保留查找记录；这不表示网上没有资料。" : "这次还没有取得可核对的公开资料。可以继续补充条件或换个方向。"
                : "说说你想获得什么体验，阿圆会先找相关分享，再一起探索。"}
          </p>
        </div>
      )}
    </section>
  );
}
