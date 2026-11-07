import { useEffect, useState } from "react";
import { Modal } from "antd";
import { Camera, Pencil, Users } from "lucide-react";
import type { Experience, Item, Workspace } from "../api";
import type { Editor } from "./Editors";
import { safeDate } from "./shared";
import "./family-ui.css";

export default function FamilyMemories({ workspace, item, householdId, edit }: {
  workspace: Workspace; item: Item; householdId: string; edit: (editor: Editor) => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const house = workspace.households.find((value) => value.id === householdId && value.membership === "active");
  const sharedHere = Boolean(house?.item_ids.includes(item.id));
  const records = sharedHere ? workspace.experiences.filter((exp) =>
    exp.household_id === householdId && exp.item_ids.includes(item.id),
  ) : [];
  const selected = records.find((exp) => exp.id === selectedId);
  useEffect(() => setSelectedId(""), [item.id, householdId]);
  function author(exp: Experience) {
    if (exp.access === "owner") return "我";
    return house?.members.find((member) => member.id === exp.creator_id)?.display_name || String(exp.provenance.author_name || "家人");
  }
  if (!sharedHere) return <p className="empty-note">这件物品目前没有共享到当前家庭。</p>;
  return (
    <section className="family-memory-section" aria-label="家庭共同回忆">
      <div className="family-memory-heading"><div><h3><Users size={18} />我们与它的回忆</h3>
        <p>{house?.name}成员可见，每人保留自己的署名原文。</p></div>
        <button className="soft-button" onClick={() => edit({ kind: "experience", item, householdId })}><Camera size={17} />留下一刻</button>
      </div>
      <p className="form-note">共享物品不会公开你的私人回忆。只有明确选入这个家庭的记录会出现在这里。</p>
      {records.length ? <div className="family-memory-grid">{records.map((exp) => (
        <button key={exp.id} className="family-memory-card" onClick={() => setSelectedId(exp.id)}>
          {exp.photo_ids[0] && <img src={`/api/assets/${exp.photo_ids[0]}`} alt={exp.title} loading="lazy" />}
          <span><small>{author(exp)}留下 · {safeDate(exp.occurred_on)}</small><strong>{exp.title}</strong>
            <p>{exp.text.slice(0, 160) || "一起留下的一张照片"}</p></span>
        </button>
      ))}</div> : <p className="empty-note">第一次一起做饭，或今天的小插曲，都值得留下。</p>}
      <Modal open={Boolean(selected)} title={selected?.title} footer={null} onCancel={() => setSelectedId("")} width={680}>
        {selected && <article className="memory-detail">
          <p className="family-memory-author">{author(selected)}记录 · {safeDate(selected.occurred_on)} · {house?.name}成员可见</p>
          <div className="memory-detail-photos">{selected.photo_ids.map((id) => <a key={id} href={`/api/assets/${id}`} target="_blank" rel="noreferrer"><img src={`/api/assets/${id}`} alt="这段家庭回忆的照片，打开查看原图" /></a>)}</div>
          <p className="memory-original">{selected.text}</p>
          {selected.origin_id && <p className="form-note">随礼物收到的故事，保留原作者的经历；不代表分享者亲历。</p>}
          <p className="form-note">这是记录者的原文。你可以另外留下一段自己的回忆。</p>
          <div className="detail-actions">
            {selected.access === "owner" && <button className="soft-button" onClick={() => {
              setSelectedId(""); edit({ kind: "experience", experience: selected, householdId });
            }}><Pencil size={16} />补充我的记录</button>}
            <button className="quiet-button" onClick={() => {
              setSelectedId(""); edit({ kind: "experience", item, householdId });
            }}>我也记一段</button>
          </div>
        </article>}
      </Modal>
    </section>
  );
}
