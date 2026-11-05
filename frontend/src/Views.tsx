import { useState } from 'react';
import { Button, Empty, Modal } from 'antd';
import { ArrowUpRight, BookOpen, Camera, Check, Flower2, Gift as GiftIcon, Headphones, Heart, LampDesk, Leaf, Mountain, Plus, Printer, Sparkles, Users } from 'lucide-react';
import type { Experience, Friend, Gift, Item, Reminder, User } from './api';

export function ObjectArt({ item, small = false }: { item: Item; small?: boolean }) {
  const title = item.name + ' ' + item.product.model;
  const Icon = /耳机|WH-/i.test(title) ? Headphones : /打印|L3256/.test(title) ? Printer : /灯/.test(title) ? LampDesk : /石/.test(title) ? Mountain : /画|向日葵/.test(title) ? Flower2 : Leaf;
  return item.photo_id ? <img className="object-photo" src={`/api/assets/${item.photo_id}`} alt={item.name} /> :
    <div className={`object-art ${small ? 'small' : ''}`} style={{ '--object-color': item.avatar.color || '#bda78c' } as React.CSSProperties}>
      <div className="object-halo" /><Icon size={small ? 45 : 95} strokeWidth={1.05} /><span className="object-shadow" />
    </div>;
}

export function ObjectGrid({ items, onSelect, onAdd }: { items: Item[]; onSelect: (item: Item) => void; onAdd: () => void }) {
  return <div className="object-grid">{items.map((item, i) => <button className={`object-card tone-${i % 5}`} key={item.id} onClick={() => onSelect(item)}>
    <div className="object-visual"><ObjectArt item={item} /><span className="object-open"><ArrowUpRight size={17} /></span></div>
    <div className="object-caption"><h3>{item.name}</h3><p>{item.product.model || '独一份的纪念'}</p><span>{item.access === 'shared' ? '与我共享' : item.kind === 'nonstandard_object' ? '有故事的物' : '日常相伴'}</span></div>
  </button>)}<button className="add-object-card" onClick={onAdd}><span><Plus size={25} strokeWidth={1.2} /></span><strong>认识一件新物品</strong><p>拍张照片，或从一个名字开始</p></button></div>;
}

export function MemoryWall({ experiences, onAdd, onSelect }: { experiences: Experience[]; onAdd: () => void; onSelect: (id: string) => void }) {
  return <><div className="section-heading"><div><span className="eyebrow">LITTLE MOMENTS</span><h2>一起的日子</h2><p>有些价值，藏在一段经历里。</p></div><Button icon={<Plus size={16} />} onClick={onAdd}>记下一刻</Button></div>
    {!experiences.length ? <Empty description="第一段回忆，从你想留下的这一刻开始" /> : <div className="memory-grid">{experiences.map((experience, i) => <article className={`memory-card memory-tone-${i % 3}`} key={experience.id}>
      {!!experience.photo_ids.length ? <img className="memory-photo" src={`/api/assets/${experience.photo_ids[0]}`} alt={experience.title} /> : <div className="memory-illustration">{i % 2 ? <Flower2 size={57} strokeWidth={1} /> : <Mountain size={57} strokeWidth={1} />}<span>日子留下的形状</span></div>}
      <div className="memory-body"><time>{experience.occurred_on.replaceAll('-', '.')}</time><h3>{experience.title}</h3><p>{experience.text}</p><div className="memory-tags">{experience.item_ids.map(id => <button onClick={() => onSelect(id)} key={id}>{experience.item_labels[id] || '相关物品'}<ArrowUpRight size={11} /></button>)}</div>{experience.origin_id && <small>随礼物收到的故事</small>}</div>
    </article>)}</div>}</>;
}

export function Explore({ onAsk }: { onAsk: (text: string) => void }) {
  const ideas = [
    { icon: BookOpen, tag: '从一个目标开始', title: '给自己一个读书角', text: '用已有的灯、摆件和身边的物，找到舒服的组合。', prompt: '我想用已经拥有的物品布置一个舒服的读书角。先了解我的资源和条件，再给我不同的布置思路。' },
    { icon: Sparkles, tag: '没有计划，也很好', title: '今天，玩点不一样的', text: '发现一件物的新用法，或几件物的意外相遇。', prompt: '最近有点无聊，请看看我已有的物品，找一些我可能没想到的单物或多物组合玩法。可以参考真实社区案例，再给我新的设想。' },
    { icon: Camera, tag: '让想法发生', title: '拍一张有氛围的照片', text: '已有的光、背景和小物件，可以怎样相互成就？', prompt: '我想用已有物品拍一张有氛围的照片。请寻找可以组合的光源、背景和道具，说明哪些条件还需要确认。' },
    { icon: Heart, tag: '把心意放进去', title: '做一份有故事的礼物', text: '让一件物，带着你的温暖去陪伴另一个人。', prompt: '我想从已有物品中准备一份有故事的礼物，给最近有点低落的朋友。请帮我想礼物、故事和分身性格，先不要实际送出。' },
  ];
  return <><div className="section-heading"><div><span className="eyebrow">A LITTLE POSSIBILITY</span><h2>灵感，留给想探索的时候</h2><p>从已有的物出发，看看生活还能怎样发生。</p></div></div><div className="inspiration-grid">{ideas.map(idea => <button className="inspiration-card" key={idea.title} onClick={() => onAsk(idea.prompt)}><div className="inspiration-icon"><idea.icon size={30} strokeWidth={1.2} /></div><span className="eyebrow">{idea.tag}</span><h3>{idea.title}</h3><p>{idea.text}</p><span className="explore-link">一起想想 <ArrowUpRight size={15} /></span></button>)}</div><div className="quiet-note"><Leaf size={18} />灵感会在这里等你，日常使用不必被打扰。</div></>;
}

export function Family({ user, friends, gifts, reminders, onAddFriend, onReminder, onAcceptFriend, onAcceptGift, onComplete }: {
  user: User; friends: Friend[]; gifts: Gift[]; reminders: Reminder[];
  onAddFriend: () => void; onReminder: () => void; onAcceptFriend: (id: string) => void;
  onAcceptGift: (id: string) => Promise<boolean>; onComplete: (id: string) => void;
}) {
  const [preview, setPreview] = useState<Gift | null>(null);
  return <><div className="section-heading"><div><span className="eyebrow">CARE GOES AROUND</span><h2>家人与心意</h2><p>共享一点帮助，也传递一段故事。</p></div><Button onClick={onAddFriend} icon={<Users size={16} />}>添加家人或朋友</Button></div>
    <div className="family-friends">{friends.map(friend => <div className="friend-card" key={friend.id}><span className="friend-avatar">{friend.display_name.slice(-1)}</span><div><strong>{friend.display_name}</strong><small>{friend.accepted ? '已经相连' : friend.incoming ? '希望和你相连' : '等待对方接受'}</small></div>{!friend.accepted && friend.incoming && <Button size="small" onClick={() => onAcceptFriend(friend.sender_id)}>接受</Button>}</div>)}</div>
    <div className="subsection-heading"><h3>共同照顾的小事</h3><button className="text-button" onClick={onReminder}><Plus size={15} />添加提醒</button></div>
    <div className="reminder-list">{!reminders.length && <p className="empty-note">重要的小事，可以留在这里一起照顾。</p>}{reminders.map(reminder => <div className={`reminder ${reminder.completed ? 'completed' : ''}`} key={reminder.id}><button className="check-circle" disabled={reminder.completed} onClick={() => onComplete(reminder.id)} aria-label={`完成${reminder.title}`}>{reminder.completed && <Check size={14} />}</button><div><strong>{reminder.title}</strong><small>{reminder.due_at.replace('T', ' ').slice(0,16)} · {reminder.assignee_id === user.id ? '由我照顾' : friends.find(f => f.id === reminder.assignee_id)?.display_name || '家人'}</small></div></div>)}</div>
    <div className="subsection-heading"><h3>往来的心意</h3><span>礼物，也可以是一段陪伴</span></div>
    <div className="gifts-grid">{!gifts.length && <div className="gift-empty"><GiftIcon size={34} strokeWidth={1.1} /><p>从物品空间送出一件有故事的礼物。</p></div>}{gifts.map(gift => <button className="gift-card" key={gift.id} onClick={() => setPreview(gift)}><span className="gift-icon"><GiftIcon size={25} strokeWidth={1.2} /></span><div><small>{gift.recipient.id === user.id ? `${gift.sender.display_name}送来的` : `送给${gift.recipient.display_name}`}</small><h3>{gift.snapshot.name}</h3><p>{gift.snapshot.message || '一份带着心意的礼物'}</p><span className="gift-status">{gift.status === 'accepted' ? '已经接收' : '待接收'} · {gift.snapshot.experiences.length}段故事</span></div><ArrowUpRight size={17} /></button>)}</div>
    <Modal title="一份送给你的心意" open={!!preview} onCancel={() => setPreview(null)} footer={preview && preview.recipient.id === user.id && preview.status === 'pending' ? <Button type="primary" onClick={async () => { if (await onAcceptGift(preview.id)) setPreview(null); }}>接收礼物与选定故事</Button> : null}>
      {preview && <div className="gift-preview"><GiftIcon size={40} strokeWidth={1} /><h2>{preview.snapshot.name}</h2><p>{preview.snapshot.message}</p><small>来自 {preview.sender.display_name}</small><div className="gift-persona"><strong>{preview.snapshot.avatar.nickname || preview.snapshot.name}</strong><p>{preview.snapshot.avatar.personality || '新的性格，会在你们的相处中慢慢生长。'}</p></div>{preview.snapshot.experiences.map(exp => <article key={exp.id}><h4>{exp.title}</h4><p>{exp.text}</p></article>)}<p className="muted">接收后由你决定它之后的样子与故事，实体交付由你们约定。</p></div>}
    </Modal>
  </>;
}
