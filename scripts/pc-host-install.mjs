import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
process.umask(0o077);
const source=fileURLToPath(new URL('../',import.meta.url));
const support=path.join(os.homedir(),'Library/Application Support/Wujian Host');
const origin=process.argv[2];
if(!origin||new URL(origin).protocol!=='https:') throw Error('需要固定 HTTPS 入口');
const key=path.join(source,'.runtime/pc-host/host-key');
if(!fs.existsSync(key)||!fs.existsSync(path.join(source,'.next-companion-release/BUILD_ID'))) throw Error('缺少构建或连接配置');
fs.mkdirSync(support,{recursive:true,mode:0o700});
const plist=path.join(os.homedir(),'Library/LaunchAgents/com.wujian.pc-host.plist');
spawnSync('/bin/launchctl',['bootout','gui/'+process.getuid(),plist],{stdio:'ignore'});
for(const relative of ['node_modules','.next-companion-release','public','resources','next.config.mjs','package.json']) {
  const from=path.join(source,relative),to=path.join(support,relative);
  fs.cpSync(from,to,{recursive:true,filter:p=>!p.includes('/.next-companion-release/cache/')&&!p.endsWith('/.next-companion-release/cache')});
}
for(const folder of ['bin','scripts','logs','data']) fs.mkdirSync(path.join(support,folder),{recursive:true,mode:0o700});
fs.copyFileSync(process.execPath,path.join(support,'bin/node'));fs.chmodSync(path.join(support,'bin/node'),0o700);
for(const name of ['mobile-demo-start.mjs','pc-host-relay.mjs']) fs.copyFileSync(path.join(source,'scripts',name),path.join(support,'scripts',name));
for(const [from,to] of [[path.join(source,'.env.local'),'.env.local'],[key,'host-key']]) {
  fs.copyFileSync(from,path.join(support,to));fs.chmodSync(path.join(support,to),0o600);
}
const build=fs.readFileSync(path.join(source,'.next-companion-release/BUILD_ID'),'utf8').trim();
fs.writeFileSync(path.join(support,'host-config.json'),JSON.stringify({origin:new URL(origin).origin,build}));
const xml=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
fs.mkdirSync(path.dirname(plist),{recursive:true});
fs.writeFileSync(plist,`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>com.wujian.pc-host</string><key>ProgramArguments</key><array><string>${xml(path.join(support,'bin/node'))}</string><string>${xml(path.join(support,'scripts/pc-host-relay.mjs'))}</string></array><key>WorkingDirectory</key><string>${xml(support)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer><key>StandardOutPath</key><string>${xml(path.join(support,'logs/host.log'))}</string><key>StandardErrorPath</key><string>${xml(path.join(support,'logs/error.log'))}</string></dict></plist>`);
fs.chmodSync(plist,0o644);
const result=spawnSync('/bin/launchctl',['bootstrap','gui/'+process.getuid(),plist],{encoding:'utf8'});
if(result.status!==0) throw Error('自动启动安装未完成：'+result.stderr);
console.log('已安装电脑共享服务，登录后自动启动。固定入口：'+new URL(origin).origin+'/');
