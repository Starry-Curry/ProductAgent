import { useEffect, useState } from 'react';
import { App as AntApp, Button, Checkbox, Input, Modal, Select } from 'antd';
import { Camera, Trash2 } from 'lucide-react';
import { request, upload, type Experience, type Friend, type Item, type Memory } from './api';

export type DialogKind = 'new-item' | 'edit-item' | 'experience' | 'gift' | 'reminder' | 'friend' | 'share' | 'memory';

function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function EditorDialogs({ mode, item, items, friends, experiences, onClose, onDone }: {
  mode: DialogKind; item?: Item; items: Item[]; friends: Friend[]; experiences: Experience[];
  onClose: () => void; onDone: (item?: Item, recognize?: boolean) => Promise<void>;
}) {
  const { message } = AntApp.useApp();
  const editing = mode === 'edit-item';
  const [name, setName] = useState(editing ? item?.name || '' : '');
  const [brand, setBrand] = useState(editing ? item?.product.brand || '' : '');
  const [model, setModel] = useState(editing ? item?.product.model || '' : '');
  const [kind, setKind] = useState<string>(editing ? item?.kind || 'standard_product' : 'standard_product');
  const [description, setDescription] = useState(editing ? item?.description || '' : '');
  const [nickname, setNickname] = useState(item?.avatar.nickname || '');
  const [personality, setPersonality] = useState(item?.avatar.personality || '');
  const [color, setColor] = useState(item?.avatar.color || '#c6a174');
  const [photoIds, setPhotoIds] = useState<string[]>(editing && item?.photo_id ? [item.photo_id] : []);
  const [selectedItems, setSelectedItems] = useState(item ? [item.id] : []);
  const [selectedExperiences, setSelectedExperiences] = useState<string[]>([]);
  const [recipient, setRecipient] = useState(mode === 'reminder' ? undefined : friends.find(friend => friend.accepted)?.id);
  const [text, setText] = useState('');
  const [date, setDate] = useState(localDate());
  const [due, setDue] = useState(localDate() + 'T18:00');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [sharedIds, setSharedIds] = useState<string[]>([]);

  useEffect(() => {
    if (mode === 'memory') request<Memory[]>('/memories').then(setMemories).catch(error => message.error(error.message));
    if (mode === 'share' && item) request<{ id: string }[]>(`/items/${item.id}/shares`).then(rows => setSharedIds(rows.map(row => row.id))).catch(error => message.error(error.message));
  }, [mode, item?.id]);

  const titles: Record<DialogKind, string> = {
    'new-item': '认识一件新物品', 'edit-item': '它在你这里的样子', experience: '留住这一刻', gift: '送一件有故事的礼物',
    reminder: '一起照顾一件小事', friend: '与家人朋友相连', share: '共享使用与照顾', memory: '物间对你的理解',
  };

  async function save() {
    setLoading(true);
    try {
      if (mode === 'new-item' || mode === 'edit-item') {
        if (!name.trim() && !photoIds.length) throw new Error('先写下名字，或添加一张照片');
        const payload = { name: name.trim() || '新物品', kind, product: { ...(editing ? item?.product : {}), brand, model, market: 'CN' },
          description, avatar: { nickname: nickname || name.trim(), personality, color }, photo_id: photoIds[0] || null,
          ...(editing && item ? { expected_version: item.version, state: item.state } : {}) };
        const result = await request<Item>(editing ? `/items/${item!.id}` : '/items', editing ? 'PUT' : 'POST', payload);
        await onDone(result, !editing && !!photoIds.length);
      } else if (mode === 'experience') {
        await request('/experiences', 'POST', { title: name, text, occurred_on: date, item_ids: selectedItems, photo_ids: photoIds });
        await onDone();
      } else if (mode === 'gift' && item) {
        if (!recipient) throw new Error('请选择接收礼物的好友');
        await request('/gifts', 'POST', { item_id: item.id, recipient_id: recipient, message: text,
          experience_ids: selectedExperiences, avatar: { nickname: nickname || item.name, personality, color } });
        await onDone();
      } else if (mode === 'reminder') {
        await request('/reminders', 'POST', { title: name, due_at: due, assignee_id: recipient || null, item_id: selectedItems[0] || null });
        await onDone();
      } else if (mode === 'friend') {
        await request('/friends', 'POST', { username });
        await onDone();
      }
      message.success(mode === 'gift' ? '心意已送出，等对方接收' : mode === 'friend' ? '邀请已送出' : '已经留下');
      onClose();
    } catch (error) { message.error((error as Error).message); }
    finally { setLoading(false); }
  }

  const avatarFields = <><div className="form-row"><label>它的名字<Input value={nickname} onChange={event => setNickname(event.target.value)} placeholder="你习惯怎样称呼它" /></label><label className="color-field">它的颜色<input type="color" value={color} onChange={event => setColor(event.target.value)} /></label></div><label>相处时的性格<Input.TextArea rows={3} value={personality} onChange={event => setPersonality(event.target.value)} placeholder="例如：温柔、有一点幽默；以后也会在共同经历里成长" /></label></>;
  const photoField = <div className="photo-field">{photoIds.map(id => <button key={id} title="移除照片" onClick={() => setPhotoIds(photoIds.filter(value => value !== id))}><img src={`/api/assets/${id}`} alt="所选照片" /><span>×</span></button>)}<label className="photo-upload"><Camera size={23} strokeWidth={1.4} /><span>添加照片</span><input type="file" accept="image/*" capture="environment" hidden disabled={loading} onChange={async event => {
    const file = event.target.files?.[0]; if (!file) return;
    setLoading(true);
    try { const result = await upload(file); setPhotoIds(previous => [...previous, result.id].slice(-8)); }
    catch (error) { message.error((error as Error).message); }
    finally { setLoading(false); event.target.value = ''; }
  }} /></label></div>;

  return <Modal open title={titles[mode]} onCancel={onClose} width={620} confirmLoading={loading}
    onOk={save} okText={mode === 'gift' ? '送出心意' : '保存'} footer={['memory', 'share'].includes(mode) ? null : undefined}>
    <div className="editor-form">
      {(mode === 'new-item' || mode === 'edit-item') && <>
        {photoField}
        <label>物品名称<Input value={name} onChange={event => setName(event.target.value)} placeholder="一盏灯，或一块有故事的石头" /></label>
        <label>这是一件<Select value={kind} onChange={setKind} options={[{ value: 'standard_product', label: '有品牌型号的商品' }, { value: 'nonstandard_object', label: '手作、纪念物或其他独特物品' }]} /></label>
        {kind === 'standard_product' && <div className="form-row"><label>品牌<Input value={brand} onChange={event => setBrand(event.target.value)} placeholder="可以稍后补充" /></label><label>准确型号<Input value={model} onChange={event => setModel(event.target.value)} placeholder="例如 WH-1000XM5" /></label></div>}
        <label>它与你的关系<Input.TextArea value={description} onChange={event => setDescription(event.target.value)} rows={2} placeholder="从哪里来，为什么喜欢，或你现在知道的事" /></label>
        <div className="form-divider">数字分身</div>{avatarFields}
      </>}
      {mode === 'experience' && <>{photoField}<label>给这一刻一个名字<Input value={name} onChange={event => setName(event.target.value)} placeholder="例如：第一个安静读书的晚上" /></label><label>想留下的话<Input.TextArea value={text} onChange={event => setText(event.target.value)} rows={5} placeholder="发生了什么，那时的你是什么感受…" /></label><label>发生的日子<input className="native-input" type="date" value={date} onChange={event => setDate(event.target.value)} /></label><label>一起出现在这段经历里的物<Select mode="multiple" value={selectedItems} onChange={setSelectedItems} options={items.map(value => ({ value: value.id, label: value.name }))} placeholder="可以关联多件物品" /></label></>}
      {mode === 'gift' && item && <><p className="form-note">把「{item.name}」送给好友，也把你选定的心意留在它身上。</p><label>送给<Select value={recipient} onChange={setRecipient} options={friends.filter(friend => friend.accepted).map(friend => ({ value: friend.id, label: friend.display_name }))} /></label><label>想对他说的话<Input.TextArea rows={3} value={text} onChange={event => setText(event.target.value)} placeholder="愿这束向日葵，陪你慢慢找到光。" /></label>{avatarFields}<label>随礼物送出的故事<div className="story-choices">{experiences.filter(value => value.item_ids.includes(item.id)).map(value => <Checkbox key={value.id} checked={selectedExperiences.includes(value.id)} onChange={event => setSelectedExperiences(event.target.checked ? [...selectedExperiences, value.id] : selectedExperiences.filter(id => id !== value.id))}>{value.title}</Checkbox>)}{!experiences.some(value => value.item_ids.includes(item.id)) && <span className="muted">可以先在回忆里为它写下一段故事。</span>}</div></label><p className="muted">对方接收后，会拥有这件物品与选定故事；其他私人聊天和记忆不会随之送出。</p></>}
      {mode === 'reminder' && <><label>需要照顾的小事<Input value={name} onChange={event => setName(event.target.value)} placeholder="例如：看看净水器滤芯状态" /></label><label>何时提醒<input className="native-input" type="datetime-local" value={due} onChange={event => setDue(event.target.value)} /></label><label>由谁照顾<Select allowClear placeholder="我自己" value={recipient} onChange={setRecipient} options={friends.filter(value => value.accepted).map(value => ({ value: value.id, label: value.display_name }))} /></label><label>相关物品<Select allowClear value={selectedItems[0]} onChange={value => setSelectedItems(value ? [value] : [])} options={items.map(value => ({ value: value.id, label: value.name }))} /></label><p className="muted">分给家人的物品事项，需要先共享这件物品的使用知识。</p></>}
      {mode === 'friend' && <><p className="form-note">用对方的用户名发送邀请，对方接受后就可以互相赠礼与协作。</p><label>对方的用户名<Input value={username} onChange={event => setUsername(event.target.value)} placeholder="例如 xiaoxia" /></label></>}
      {mode === 'share' && item && <><p className="form-note">让家人朋友获得「{item.name}」的使用知识与共同状态。你的私人回忆、聊天和分身设定仍由你保留。</p>{friends.filter(value => value.accepted).map(friend => <Checkbox key={friend.id} checked={sharedIds.includes(friend.id)} onChange={async event => {
        try {
          if (event.target.checked) await request(`/items/${item.id}/shares`, 'POST', { user_id: friend.id });
          else await request(`/items/${item.id}/shares/${friend.id}`, 'DELETE');
          setSharedIds(previous => event.target.checked ? [...previous, friend.id] : previous.filter(id => id !== friend.id));
          await onDone();
        } catch (error) { message.error((error as Error).message); }
      }}>{friend.display_name}</Checkbox>)}{!friends.some(value => value.accepted) && <p>先添加一位家人或朋友。</p>}</>}
      {mode === 'memory' && <><p className="form-note">日常聊天中有用的理解会安静保留。你可以在这里查看和移除；主动写下的照片文字在回忆墙里。</p>{!memories.length && <p className="muted">这里还没有积累的理解。</p>}{memories.map(memory => <div className="memory-setting" key={memory.id}><div><p>{memory.content}</p><small>{memory.basis === 'inference' ? '暂时的理解，可以纠正' : '来自你的表达'}</small></div><Button type="text" aria-label="移除这条理解" icon={<Trash2 size={15} />} onClick={async () => {
        try { await request(`/memories/${memory.id}`, 'DELETE'); setMemories(previous => previous.filter(value => value.id !== memory.id)); message.success('已从长期理解中移除'); }
        catch (error) { message.error((error as Error).message); }
      }} /></div>)}</>}
    </div>
  </Modal>;
}
