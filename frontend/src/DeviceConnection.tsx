import { useEffect, useState } from 'react';
import { App, Button, Input, Modal, Select, Space } from 'antd';
import { request, type Item, type DeviceStatus } from './api';


export default function DeviceConnection({ item, onClose, onAsk }: { item: Item; onClose: () => void; onAsk: (text: string) => void }) {
  const [kind, setKind] = useState('browser_cdp');
  const [address, setAddress] = useState('');
  const [status, setStatus] = useState<DeviceStatus>();
  const [busy, setBusy] = useState(false);
  const { message } = App.useApp();
  useEffect(() => { request<DeviceStatus>('/devices/status').then(setStatus).catch(error => message.error(error.message)); }, []);
  async function connect() {
    setBusy(true);
    try {
      const next = await request<DeviceStatus>('/devices/status?connect=true');
      setStatus(next);
      if (next.error) throw new Error(next.error);
      await request(`/items/${item.id}/device`, 'POST', { kind, address });
      setStatus(await request<DeviceStatus>('/devices/status'));
      setAddress('');
    } catch (error) { message.error((error as Error).message); }
    finally { setBusy(false); }
  }
  const targets = status?.targets.filter(target => target.item_id === item.id) || [];
  return <Modal open title={`让${item.name}更合心意`} onCancel={onClose} footer={null}>
    <p>先连接它的控制网页或配套软件，再一起探索它能够实现的改变。</p>
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Select style={{ width: '100%' }} value={kind} onChange={setKind} options={[
        { value: 'browser_cdp', label: '网页控制端 · 已开启调试连接的浏览器' },
        { value: 'javascript_artifact', label: '本机 JavaScript / Electron 软件包' },
      ]} />
      <Input value={address} onChange={event => setAddress(event.target.value)} placeholder={kind === 'browser_cdp' ? '本机调试连接地址，例如 http://127.0.0.1:9222' : '已授权的软件包绝对路径'} />
      <Button type="primary" loading={busy} disabled={!address.trim()} onClick={connect}>连接这个入口</Button>
      <small>{status?.bridge_connected ? 'REA 探索服务已连接。具体能改什么，需要检查实际入口。' : '连接入口时会启动本机探索服务。'}</small>
      {targets.map(target => <div key={target.id}><p>{target.address}</p><Button onClick={() => { onClose(); onAsk(`我已为${item.name}登记了控制入口，连接ID是${target.id}。请先探索这个入口的实际能力，看看能否更换屏保或显示内容；还不要执行修改。`); }}>先看看它能做什么</Button></div>)}
      {!targets.length && <small>仅拍照录入物品还没有控制连接。普通显示器的改变通常要从连接电脑或投屏软件入手。</small>}
    </Space>
  </Modal>;
}
