import React from 'react';
import ReactDOM from 'react-dom/client';
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './features/App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={{ token: {
      colorPrimary: '#779eae', colorText: '#252b2b', colorBgContainer: '#fcfaf8',
      borderRadius: 12, fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif',
    } }}>
      <AntApp><App /></AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
