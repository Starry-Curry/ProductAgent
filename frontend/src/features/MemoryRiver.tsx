import { ArrowUpRight, Camera } from "lucide-react";
import type { Experience } from "../api";
import { safeDate } from "./shared";
import "./memory-river.css";

export default function MemoryRiver({ experiences, cover, attribution, open, record }: {
  experiences: Experience[];
  cover: (experience: Experience) => { id: string; related: boolean } | null;
  attribution: (experience: Experience) => string;
  open: (experience: Experience) => void;
  record: () => void;
}) {
  const days = [...new Set(experiences.map(exp => exp.occurred_on || ""))].sort((a,b) => b.localeCompare(a));
  function jump(index: number) {
    document.getElementById(`river-day-${index}`)?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  let position = 0;
  return <div className="memory-river">
    <div className="river-intro">
      <span className="river-intro-line" aria-hidden="true" />
      <p>那些平凡的日子，<br />因为被记得，而闪闪发光。</p>
      <span className="river-count">{experiences.length} 段回忆，在这里相逢</span>
    </div>
    <nav className="river-dates" aria-label="沿着日期寻找回忆">
      <span>沿着时光</span>
      {days.map((day,index) => <button key={day || "undated"} onClick={() => jump(index)}>{day ? safeDate(day) : "未记日期"}</button>)}
    </nav>
    <div className="river-course">
      <div className="river-water" aria-hidden="true"><i /><i /><i /></div>
      {days.map((day,index) => <section className="river-day-group" id={`river-day-${index}`} key={day || "undated"}>
        <header className="river-day-heading"><span className="river-pearl" /><time dateTime={day || undefined}>{day ? safeDate(day) : "未记日期的片刻"}</time><small>{day ? "留在时光里" : "不记得哪一天，也值得珍藏"}</small></header>
        {experiences.filter(exp => (exp.occurred_on || "") === day).map(exp => {
          const visual = cover(exp);
          const side = position++ % 2 === 0 ? "left" : "right";
          return <div className={`river-moment river-moment-${side}`} key={exp.id}>
            <span className="river-moment-dot" aria-hidden="true" />
            <button className={`river-keepsake ${visual ? "" : "river-letter"}`} onClick={() => open(exp)} aria-label={`打开回忆：${exp.title}`}>
              {visual ? <div className="river-photo"><img src={`/api/assets/${visual.id}`} alt={visual.related ? `${exp.title}关联的物品` : exp.title} loading="lazy" />{visual.related && <span className="memory-cover-caption">相关物品</span>}</div> : <span className="river-quote" aria-hidden="true">“</span>}
              <div className="river-story-copy"><span className="river-author">{attribution(exp)}</span><h2>{exp.title}</h2><p>{exp.text}</p><footer><span>{Object.values(exp.item_labels).join(" · ") || "生活里的一个片刻"}</span><ArrowUpRight size={18} /></footer></div>
            </button>
            <span className="river-whisper" aria-hidden="true">{side === "left" ? "一些瞬间，值得慢慢回望。" : "时光向前，温暖留下。"}</span>
          </div>;
        })}
      </section>)}
      <div className="river-next"><span className="river-pearl" /><p>故事还在继续</p><small>把下一次想留住的瞬间，也放在这里。</small><button className="soft-button" onClick={record}><Camera size={17} />记下一刻</button></div>
    </div>
  </div>;
}
