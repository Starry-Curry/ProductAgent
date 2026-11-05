import { useEffect, useRef, useState } from 'react';
import { App as AntApp, Button, Dropdown, Input, Spin } from 'antd';
import { ArrowLeft, ArrowUpRight, BookHeart, Camera, ChevronDown, Gift as GiftIcon, Heart, Leaf, MessageCircle, MoreHorizontal, Plus, Search, Settings2, Share2, Sparkles, Users, Boxes } from 'lucide-react';
import { request, type ChatMessage, type Conversation, type Experience, type Friend, type Gift, type Health, type Item, type Reminder, type Run, type User } from './api';
import ChatPanel from './ChatPanel';
import DeviceConnection from './DeviceConnection';
import EditorDialogs, { type DialogKind } from './EditorDialogs';
import { Explore, Family, MemoryWall, ObjectArt, ObjectGrid } from './Views';

type Tab = 'items' | 'memories' | 'explore' | 'family';

function SignIn({ health, onLogin }: { health: Health | null; onLogin: (user: User) => void }) {
  const [registering, setRegistering] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const { message } = AntApp.useApp();
  async function login(persona?: string) {
    setBusy(true);
    try {
      const user = await request<User>(persona ? `/auth/demo/${persona}` : registering ? '/auth/register' : '/auth/login', 'POST',
        persona ? undefined : { username, password, ...(registering ? { display_name: displayName } : {}) });
      onLogin(user);
    } catch (error) { message.error((error as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="signin-page"><div className="signin-story"><div className="brand"><span className="brand-mark">物</span><span>物间<small>WUJIAN</small></span></div><span className="eyebrow">THINGS, WITH YOU.</span><h1>物有来处，<br />也有新的故事。</h1><p>用好身边的物，发现未曾想到的可能。<br />把一起的日子，留在这里。</p><div className="signin-art"><span className="art-circle" /><Leaf size={155} strokeWidth={0.65} /><span className="art-caption">每一件物，都与你有关。</span></div></div>
    <div className="signin-form"><div><span className="eyebrow">YOUR OWN LITTLE WORLD</span><h2>{registering ? '从这里，开始你的物间' : '欢迎回到物间'}</h2><p>人与物的关系，会在日常里慢慢生长。</p></div>
      <form onSubmit={event => { event.preventDefault(); login(); }}>
        {registering && <label>怎么称呼你<Input value={displayName} onChange={event => setDisplayName(event.target.value)} autoComplete="nickname" /></label>}
        <label>用户名<Input value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" placeholder={registering ? '3至32位字母、数字或下划线' : '你的用户名'} /></label>
        <label>密码<Input.Password value={password} onChange={event => setPassword(event.target.value)} autoComplete={registering ? 'new-password' : 'current-password'} placeholder="至少8位" /></label>
        <Button type="primary" htmlType="submit" size="large" block loading={busy}>{registering ? '建立我的物间' : '进入我的物间'}<ArrowUpRight size={16} /></Button>
      </form>
      <button className="text-button" onClick={() => setRegistering(!registering)}>{registering ? '已有账号，返回登录' : '第一次来？建立自己的物间'}</button>
      {health?.demo_mode && <div className="demo-entry"><span>也可以先逛逛体验档案</span><div><Button onClick={() => login('xiaolin')} disabled={busy}>小林的物间</Button><Button onClick={() => login('xiaoxia')} disabled={busy}>小夏的物间</Button></div><small>体验档案中的拥有关系和经历为模拟内容。</small></div>}
    </div></div>;
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [tab, setTab] = useState<Tab>('items');
  const [items, setItems] = useState<Item[]>([]);
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [conversationId, setConversationId] = useState<string>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const eventSource = useRef<EventSource | null>(null);
  const { message } = AntApp.useApp();
  const selected = items.find(item => item.id === selectedId);
  const busy = submitting || run?.status === 'queued' || run?.status === 'running';

  useEffect(() => {
    Promise.all([
      request<Health>('/health').then(setHealth),
      request<User>('/me').then(setUser).catch(() => setUser(null)),
    ]).finally(() => setReady(true));
    return () => eventSource.current?.close();
  }, []);

  async function refresh() {
    const [nextItems, nextExperiences, nextFriends, nextGifts, nextReminders, nextConversations] = await Promise.all([
      request<Item[]>('/items'), request<Experience[]>('/experiences'), request<Friend[]>('/friends'),
      request<Gift[]>('/gifts'), request<Reminder[]>('/reminders'), request<Conversation[]>('/conversations'),
    ]);
    setItems(nextItems); setExperiences(nextExperiences); setFriends(nextFriends);
    setGifts(nextGifts); setReminders(nextReminders); setConversations(nextConversations);
  }
  useEffect(() => { if (user) refresh().catch(error => message.error(error.message)); }, [user?.id]);

  async function action(operation: () => Promise<unknown>) {
    try { await operation(); await refresh(); return true; }
    catch (error) { message.error((error as Error).message); return false; }
  }

  function watchRun(initial: Run) {
    eventSource.current?.close();
    setRun(initial);
    if (!['queued', 'running'].includes(initial.status)) return;
    const source = new EventSource(`/api/runs/${initial.id}/events`);
    eventSource.current = source;
    source.onmessage = async event => {
      const value: Run = JSON.parse(event.data);
      setRun(value);
      if (!['queued', 'running'].includes(value.status)) {
        source.close();
        setMessages(await request<ChatMessage[]>(`/conversations/${value.conversation_id}/messages`));
        await refresh();
      }
    };
    source.onerror = async () => {
      source.close();
      try {
        const value = await request<Run>(`/runs/${initial.id}`);
        setRun(value);
        if (['queued', 'running'].includes(value.status)) {
          message.info('对话仍在继续，稍后可从历史对话接续');
        } else setMessages(await request<ChatMessage[]>(`/conversations/${value.conversation_id}/messages`));
      } catch (error) { message.error((error as Error).message); }
    };
  }

  async function send(text: string, photos: string[] = [], explicitItems?: string[]) {
    if (busy) return;
    setChatOpen(true); setSubmitting(true);
    try {
      const result = await request<Run>('/chat', 'POST', { text, conversation_id: conversationId || null,
        item_ids: explicitItems || (selected ? [selected.id] : []), photo_ids: photos });
      setConversationId(result.conversation_id);
      setMessages(await request<ChatMessage[]>(`/conversations/${result.conversation_id}/messages`));
      watchRun(result);
    } finally { setSubmitting(false); }
  }

  async function openConversation(id: string) {
    eventSource.current?.close();
    setConversationId(id); setChatOpen(true); setRun(null);
    try {
      const history = await request<ChatMessage[]>(`/conversations/${id}/messages`);
      setMessages(history);
      const contextItem = conversations.find(conversation => conversation.id === id)?.item_ids[0];
      setSelectedId(contextItem);
      const last = history.at(-1);
      if (last?.role === 'user' && last.run_id) watchRun(await request<Run>(`/runs/${last.run_id}`));
    } catch (error) { message.error((error as Error).message); }
  }

  function newConversation() {
    eventSource.current?.close(); setConversationId(undefined); setMessages([]); setRun(null); setChatOpen(true);
  }
  async function logout() {
    eventSource.current?.close();
    await request('/auth/logout', 'POST'); setUser(null); setItems([]); setExperiences([]); setFriends([]);
    setGifts([]); setReminders([]); setConversations([]); setSelectedId(undefined); newConversation();
  }
  function selectItem(item: Item) { setSelectedId(item.id); setTab('items'); setChatOpen(true); }

  if (!ready) return <div className="loading-screen"><Leaf size={35} strokeWidth={1} /><Spin /></div>;
  if (!user) return <SignIn health={health} onLogin={setUser} />;
  const filteredItems = items.filter(item => (item.name + item.product.model + item.description).toLowerCase().includes(query.toLowerCase()));
  const navigation = [
    { key: 'items' as Tab, icon: Boxes, label: '我的物间' }, { key: 'memories' as Tab, icon: BookHeart, label: '一起的回忆' },
    { key: 'explore' as Tab, icon: Sparkles, label: '发现新可能' }, { key: 'family' as Tab, icon: Users, label: '家人与心意' },
  ];
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark">物</span><span>物间<small>WUJIAN</small></span></div><div className="workspace-label"><span className="tiny-dot" />{user.display_name}的小小世界</div>
      <nav>{navigation.map(nav => <button key={nav.key} className={tab === nav.key ? 'active' : ''} onClick={() => setTab(nav.key)}><nav.icon size={19} strokeWidth={1.5} /><span>{nav.label}</span>{nav.key === 'family' && gifts.some(gift => gift.recipient.id === user.id && gift.status === 'pending') && <i className="notification-dot" />}</button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><Leaf size={21} strokeWidth={1.2} /><p>物的价值，<br />在与你相处时生长。</p></div><button className="understanding-link" onClick={() => setDialog('memory')}><Heart size={16} /><span>物间对我的理解</span></button>
        <Dropdown menu={{ items: [{ key: 'logout', label: '退出 / 切换档案' }], onClick: () => logout() }} trigger={['click']}><button className="user-menu"><span>{user.display_name.slice(-1)}</span><div><strong>{user.display_name}</strong><small>我的物间</small></div><ChevronDown size={14} /></button></Dropdown>
      </div>
    </aside>
    <div className="app-body"><header className="topbar"><span>{navigation.find(value => value.key === tab)?.label}</span><div><span className="today">{new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())}</span><button className="icon-button" onClick={() => setChatOpen(!chatOpen)} title="打开或收起对话"><MessageCircle size={19} /></button></div></header>
      <div className={`workspace ${chatOpen ? 'with-chat' : ''}`}><main className="main-content">
        {tab === 'items' && !selected && <><div className="home-heading"><span className="eyebrow">THINGS, WITH YOU.</span><h1>{user.display_name}，你好。<span>今天也有新的可能。</span></h1><p>用好身边的物，留住一起的日子。</p><div className="home-heading-leaf"><Leaf size={73} strokeWidth={0.7} /></div></div>
          <button className="intention-card" onClick={() => { setChatOpen(true); document.querySelector<HTMLTextAreaElement>('.ant-sender textarea')?.focus(); }}><span className="intention-mark"><Sparkles size={21} strokeWidth={1.2} /></span><div><strong>有什么想做的，或想知道的？</strong><span>问问用法、组合已有物品，也可以聊聊今天。</span></div><ArrowUpRight size={20} /></button>
          <div className="collection-toolbar"><div><h2>日常相伴</h2><span>{items.length}件物品</span></div><div><Input prefix={<Search size={15} />} value={query} onChange={event => setQuery(event.target.value)} placeholder="找一件物" allowClear className="item-search" /><Button type="primary" icon={<Plus size={16} />} onClick={() => setDialog('new-item')}>添加物品</Button></div></div>
          <ObjectGrid items={filteredItems} onSelect={selectItem} onAdd={() => setDialog('new-item')} />
          <div className="home-footnote"><span className="tiny-dot" />物品档案会在使用、聊天与记录中，慢慢变得完整。</div>
        </>}
        {tab === 'items' && selected && <><button className="back-link" onClick={() => setSelectedId(undefined)}><ArrowLeft size={15} />回到我的物间</button><div className="item-detail-hero"><div className="detail-art"><ObjectArt item={selected} /></div><div><span className="eyebrow">{selected.kind === 'nonstandard_object' ? 'ONE OF A KIND' : 'YOUR EVERYDAY COMPANION'}</span><h1>{selected.name}</h1><p className="model-line">{selected.product.brand} {selected.product.model || '独一份的存在'}</p><span className="soft-tag">{selected.access === 'shared' ? '与我共享' : '我的物品'}</span><p className="personal-description">{selected.description || '相处的日子，会让我们更了解彼此。'}</p></div></div>
          <div className="item-actions"><Button onClick={() => action(() => send('请帮我了解这件物品的使用方法；具体操作请核对适用的官方资料。'))} icon={<BookHeart size={16} />}>问问用法</Button><Button onClick={() => action(() => send('请结合我的物品、偏好和真实条件，发现这件物品的新玩法，可以查找真实案例作为灵感。'))} icon={<Sparkles size={16} />}>发现新玩法</Button><Button onClick={() => setDialog('experience')} icon={<Camera size={16} />}>记下一刻</Button>{selected.access === 'owner' && <Dropdown menu={{ items: [{ key: 'edit-item', label: '形象、性格与物品信息', icon: <Settings2 size={14} /> }, { key: 'share', label: '共享使用与照顾', icon: <Share2 size={14} /> }, { key: 'gift', label: '送出这件物品与心意', icon: <GiftIcon size={14} /> }, { key: 'device', label: '连接设备与探索', icon: <Settings2 size={14} /> }], onClick: ({ key }) => key === 'device' ? setDeviceOpen(true) : setDialog(key as DialogKind) }}><Button icon={<MoreHorizontal size={17} />} aria-label="物品更多操作" /></Dropdown>}</div>
          {(selected.avatar.personality || selected.avatar.growth_note) && <div className="persona-card"><Leaf size={22} strokeWidth={1.2} /><div><strong>{selected.avatar.nickname || selected.name}</strong><p>{selected.avatar.personality}</p>{selected.avatar.growth_note && <p className="growth-note">{selected.avatar.growth_note}</p>}{selected.avatar.gift_from && <small>带着{selected.avatar.gift_from}的心意来到这里。</small>}</div>{selected.access === 'owner' && <button className="icon-button" title="调整分身" onClick={() => setDialog('edit-item')}><Settings2 size={16} /></button>}</div>}
          <MemoryWall experiences={experiences.filter(experience => experience.item_ids.includes(selected.id))} onAdd={() => setDialog('experience')} onSelect={id => { const item = items.find(value => value.id === id); if (item) selectItem(item); }} />
        </>}
        {tab === 'memories' && <MemoryWall experiences={experiences} onAdd={() => setDialog('experience')} onSelect={id => { const item = items.find(value => value.id === id); if (item) selectItem(item); else message.info('物品的关系已经变化，这段回忆仍为你保留。'); }} />}
        {tab === 'explore' && <Explore onAsk={text => action(() => send(text))} />}
        {tab === 'family' && <Family user={user} friends={friends} gifts={gifts} reminders={reminders} onAddFriend={() => setDialog('friend')} onReminder={() => setDialog('reminder')} onAcceptFriend={id => action(() => request(`/friends/${id}/accept`, 'POST'))} onAcceptGift={id => action(() => request(`/gifts/${id}/accept`, 'POST'))} onComplete={id => action(() => request(`/reminders/${id}/complete`, 'POST'))} />}
      </main>{chatOpen && <ChatPanel item={selected} messages={messages} run={submitting ? { id: '', conversation_id: '', status: 'queued', text: '', events: [], error: '', usage: {} } : run} conversations={conversations}
        onSend={send} onNew={newConversation} onSelect={openConversation} onClose={() => setChatOpen(false)} onCancel={() => run?.id && action(() => request(`/runs/${run.id}/cancel`, 'POST'))} />}</div>
    </div>
    {deviceOpen && selected && <DeviceConnection item={selected} onClose={() => setDeviceOpen(false)} onAsk={text => action(() => send(text))} />}
    {dialog && <EditorDialogs key={dialog + selectedId} mode={dialog} item={selected} items={items} friends={friends} experiences={experiences} onClose={() => setDialog(null)} onDone={async (item, recognize) => {
      await refresh();
      if (item) { setSelectedId(item.id); setTab('items'); setChatOpen(true); }
      if (item && recognize && item.photo_id) await send('请根据照片帮我认识这件物品。能确认的身份与不确定的候选请区分；需要时查找公开资料，并保留有依据的认识。', [item.photo_id], [item.id]);
    }} />}
  </div>;
}

