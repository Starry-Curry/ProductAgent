import { useEffect, useRef, useState } from 'react';
import { Sender } from '@ant-design/x';
import { App as AntApp, Dropdown } from 'antd';
import { CirclePlus, Clock3, ImagePlus, Leaf, MessageCircle, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { upload, type ChatMessage, type Conversation, type Item, type Run } from './api';

const toolLabels: Record<string, string> = {
  find_items: '寻找身边的物品', read_item: '了解这件物品', recall_memories: '回看相关经历',
  search_public_web: '查找公开资料', fetch_document: '阅读原始资料', read_source: '核对资料细节',
  view_source_page: '查看说明书图示', list_sources: '查找已有资料', remember: '更新对你的理解',
  record_experience: '留下这段经历', evolve_avatar: '整理共同成长', list_reminders: '查看相关事项',
  update_item_identity: '完善物品认识',
  search_world: '寻找相关的物与经历', read_task: '接续之前的尝试',
  learn_item_knowledge: '积累有依据的物品知识',
  device_connections: '查看设备连接', explore_device: '探索设备的实际能力',
  update_item_condition: '更新物品当前状态',
  GenerateStructuredOutput: '整理回答与后续计划',
};

export default function ChatPanel({ item, messages, run, conversations, onSend, onCancel, onNew, onSelect, onClose }: {
  item?: Item; messages: ChatMessage[]; run: Run | null; conversations: Conversation[];
  onSend: (text: string, photos?: string[]) => Promise<void>; onCancel: () => void;
  onNew: () => void; onSelect: (id: string) => void; onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { message } = AntApp.useApp();
  const busy = run?.status === 'running' || run?.status === 'queued';
  useEffect(() => bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), [messages, run?.text]);
  async function submit(text: string) {
    if ((!text.trim() && !photos.length) || busy) return;
    const attached = photos;
    setValue(''); setPhotos([]);
    try { await onSend(text, attached); }
    catch (error) { setValue(text); setPhotos(attached); message.error((error as Error).message); }
  }
  const lastTool = run?.events?.filter(event => event.type === 'tool_start').at(-1);
  return <aside className="chat-panel">
    <header className="chat-header">
      <div className="chat-avatar"><Leaf size={19} /></div>
      <div><strong>{item ? item.avatar.nickname || item.name : '和物间聊聊'}</strong><span>{item ? '用法、灵感，还有与你有关的日子' : '从你的问题，或一个想法开始'}</span></div>
      <Dropdown menu={{ items: conversations.map(c => ({ key: c.id, label: c.title })), onClick: ({ key }) => onSelect(key) }} trigger={['click']}>
        <button className="icon-button" title="继续以前的对话"><Clock3 size={17} /></button>
      </Dropdown>
      <button className="icon-button" onClick={onNew} title="新对话"><CirclePlus size={18} /></button>
      <button className="icon-button chat-close" onClick={onClose} title="收起对话"><X size={18} /></button>
    </header>
    {item && <div className="focus-strip"><span className="tiny-dot" />此刻关注 <strong>{item.name}</strong><span>也可以聊起其他物品</span></div>}
    <div className="chat-scroll">
      {!messages.length && !run && <div className="chat-welcome">
        <div className="welcome-mark"><MessageCircle size={30} strokeWidth={1.2} /></div>
        <h3>{item ? `关于${item.name}，想知道些什么？` : '身边的物，也有新的可能。'}</h3>
        <p>{item ? '可以问我怎么用，也可以一起发现新玩法，或说说你们的故事。' : '告诉我你想做的事。我会和你一起，看看已有的物品能带来什么。'}</p>
        <div className="suggestions">{(item ? ['帮我了解它的使用方法', '它还有什么有趣的新用法？', '想和你分享今天发生的事'] : ['用家里已有的物品布置读书角', '有点无聊，给我一些新玩法', '帮我找找物品的使用说明']).map(text =>
          <button key={text} onClick={() => submit(text)}>{text}<span>↗</span></button>)}</div>
      </div>}
      {messages.map(msg => <div className={`chat-message ${msg.role}`} key={msg.id}>
        {msg.role === 'assistant' && <span className="message-mark"><Leaf size={14} /></span>}
        <div className="message-content">
          {!!msg.photo_ids?.length && <div className="message-photos">{msg.photo_ids.map(id => <img src={`/api/assets/${id}`} key={id} alt="对话中上传的照片" />)}</div>}
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: props => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>{msg.text}</ReactMarkdown>
        </div>
      </div>)}
      {busy && <div className="chat-message assistant"><span className="message-mark"><Leaf size={14} /></span><div className="message-content">
        {run.text ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{run.text}</ReactMarkdown> : <div className="thinking"><i /><i /><i /></div>}
        {lastTool && <div className="tool-progress">{toolLabels[String(lastTool.name)] || '正在继续处理'}…</div>}
      </div></div>}
      {run && ['failed', 'interrupted'].includes(run.status) && <div className="inline-error">{run.error || '任务暂时停在这里，可以接着聊。'}</div>}
      <div ref={bottom} />
    </div>
    <footer className="chat-composer">
      {!!photos.length && <div className="attached-photos">{photos.map(id => <button key={id} onClick={() => setPhotos(photos.filter(p => p !== id))} title="移除附件"><img src={`/api/assets/${id}`} alt="待发送照片" /><X size={12} /></button>)}</div>}
      <Sender value={value} onChange={setValue} onSubmit={submit} loading={busy} onCancel={onCancel}
        autoSize={{ minRows: 2, maxRows: 6 }} placeholder={item ? `问问${item.name}，或说说今天的事…` : '问问用法，或说说你想做的事…'} />
      <div className="composer-bottom">
        <button className="text-button" disabled={uploading || photos.length >= 4} onClick={() => fileInput.current?.click()}><ImagePlus size={15} />{uploading ? '添加中…' : '添加照片'}</button>
        <span>Enter 发送 · Shift + Enter 换行</span>
      </div>
      <input ref={fileInput} type="file" accept="image/*" capture="environment" hidden onChange={async event => {
        const file = event.target.files?.[0]; if (!file) return;
        setUploading(true);
        try { const result = await upload(file); setPhotos(previous => [...previous, result.id]); }
        catch (error) { message.error((error as Error).message); }
        finally { setUploading(false); event.target.value = ''; }
      }} />
    </footer>
  </aside>;
}
