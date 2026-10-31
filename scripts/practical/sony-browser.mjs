import {chromium,expect} from '@playwright/test';import fs from 'node:fs';import {randomBytes} from 'node:crypto';
import {assistantResponse} from '../../tests/helpers/assistant-response.mjs';import {ROOT} from './gateway.mjs';
const stage=process.argv.find(s=>s.startsWith('--stage='))?.slice(8)||'sony-browser-v1';if(!/^[a-z0-9-]+$/.test(stage))throw Error('bad_stage');
const file=ROOT+'/'+stage+'.json';if(fs.existsSync(file))throw Error('preserve_existing_stage');
const before=JSON.parse(fs.readFileSync(ROOT+'/model-calls.json')).attempts.length;
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
// Observe a real response clone in the page. CDP cannot reliably retrieve an
// already-consumed SSE body; no route interception or fabricated response.
await context.addInitScript(()=>{window.__assistantResults=[];const original=window.fetch.bind(window);window.fetch=async(...args)=>{const r=await original(...args);if(String(args[0]).includes('/api/assistant')&&args[1]?.method==='POST'&&!JSON.parse(args[1].body||'{}').action){r.clone().text().then(body=>{let result;for(const f of body.replaceAll('\r\n','\n').split('\n\n'))if(f.startsWith('event: result'))result=JSON.parse(f.match(/^data: (.+)$/m)[1]);window.__assistantResults.push(result||{error:body});});}return r;};});
const page=await context.newPage();
const report={at:new Date().toISOString(),syntheticOwnership:true,physicalDeviceTests:0,errors:[],responses:[],checks:[]};
page.on('pageerror',e=>report.errors.push(e.message));const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
try{
 await page.goto('http://127.0.0.1:3232');await page.getByLabel('用户名',{exact:true}).fill('自然Agent验收'+Date.now());await page.getByLabel('口令',{exact:true}).fill(randomBytes(18).toString('hex'));await page.getByRole('checkbox').check();await page.getByRole('button',{name:'进入我的物间',exact:true}).click();await page.getByRole('button',{name:'生活首页',exact:true}).waitFor();
 await page.goto('http://127.0.0.1:3232/#add');await page.getByText('录入其他真实商品、说明书或自己的纪念物',{exact:true}).click();
 await page.getByLabel('物品名称',{exact:true}).fill('[模拟持有]我的Sony耳机');await page.getByLabel('品牌',{exact:true}).fill('Sony');await page.getByLabel('具体型号',{exact:true}).fill('WH-CH520');
 const form=page.locator('form').filter({has:page.getByRole('heading',{name:'确认它的信息',exact:true})});
 await form.locator('input[name="ownsConfirmed"]').check();await form.locator('input[name="available"]').check();await form.locator('input[name="synthetic"]').check();
 const created=page.waitForResponse(r=>r.url().endsWith('/api/life')&&r.request().method()==='POST'&&r.request().postDataJSON()?.action==='createItem');
 await page.getByRole('button',{name:'确认并录入物品',exact:true}).click();const body=await(await created).json();report.item={id:body.item.id,name:body.item.name,model:body.item.model,synthetic:body.item.synthetic};if(!body.item.synthetic)throw Error('synthetic_ownership_not_marked');
 await page.waitForURL('**/#item/'+body.item.id);const region=page.getByRole('region',{name:'物间统一对话',exact:true});await region.waitFor();
 async function ask(question){const started=performance.now(),before=await page.evaluate(()=>window.__assistantResults.length);await region.locator('textarea[name="question"]').fill(question);await region.getByRole('button',{name:'发送',exact:true}).click();await page.waitForFunction(n=>window.__assistantResults.length>n,before,{timeout:130000});const result=await page.evaluate(()=>window.__assistantResults.at(-1));if(!result?.reply)throw Error('no_final_result');report.responses.push({question,result,fullAnswerMs:Math.round(performance.now()-started)});save();await expect(region.locator('.assistant-prose').last()).toBeVisible({timeout:10000});return result;}
 const first=await ask('这副WH-CH520以前连过另一台手机，现在怎样重新配对新手机？请给完整步骤。');
 if(!/5|五/.test(first.reply.answer)||!first.reply.citations.some(c=>c.url.includes('helpguide.sony.net')))throw Error('pairing_or_source_missing');
 report.checks.push({name:'真实UI录入→真实千问Function Calling→官方获取→完整重新配对回答',passed:true});
 await page.screenshot({path:ROOT+'/sony-desktop.png',fullPage:false});
 const second=await ask('那恢复出厂初始化和重新配对是一回事吗？初始化按多久，原配对信息会怎样？');
 if(!/10|十/.test(second.reply.answer)||!/删除|清除/.test(second.reply.answer))throw Error('initialization_followup_missing');
 await page.setViewportSize({width:390,height:844});await region.locator('.assistant-prose').last().scrollIntoViewIfNeeded();await page.screenshot({path:ROOT+'/sony-mobile.png',fullPage:false});
 report.checks.push({name:'同一物品/会话追问：10秒初始化及删除信息，390px实际显示',passed:true});
 await context.storageState({path:'.runtime/practical-browser-state.json'});
 fs.writeFileSync('.runtime/practical-browser-item.json',JSON.stringify({sonyItemId:body.item.id}));
}catch(e){report.errors.push(e.message);await page.screenshot({path:ROOT+'/sony-failure.png'}).catch(()=>{});fs.writeFileSync('.runtime/sony-failure-dom.txt',await page.locator('body').innerText().catch(()=>''));process.exitCode=1;}
finally{report.upstreamRequests=JSON.parse(fs.readFileSync(ROOT+'/model-calls.json')).attempts.length-before;save();await browser.close();console.log(JSON.stringify({checks:report.checks,errors:report.errors,upstreamRequests:report.upstreamRequests}));}
