import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import {assistantResponse} from '../../tests/helpers/assistant-response.mjs';
const base='http://127.0.0.1:3230',dir='docs/engineering/intelligence-kernel-v3-2026-10-31/evidence';
const ledger=()=>JSON.parse(fs.readFileSync(dir+'/model-calls.json','utf8')).attempts;
const before=ledger().length;
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
const report={at:new Date().toISOString(),synthetic:true,physicalTests:0,checks:[],errors:[],responses:[]};
const save=()=>fs.writeFileSync(dir+'/browser-live-v3.json',JSON.stringify(report,null,2));
page.on('pageerror',e=>report.errors.push(e.message));
async function post(url,data){const r=await page.request.post(base+url,{data});const d=await r.json();if(!r.ok())throw Error(JSON.stringify({url,status:r.status(),error:d.error}));return d;}
try{
 await page.goto(base);await page.getByLabel('用户名',{exact:true}).fill('内核验收'+Date.now());await page.getByLabel('口令',{exact:true}).fill(randomBytes(18).toString('hex'));await page.getByRole('checkbox').check();await page.getByRole('button',{name:'进入我的物间',exact:true}).click();await page.getByRole('button',{name:'生活首页',exact:true}).waitFor();
 const item=(await post('/api/life',{action:'createItem',input:{requestId:randomUUID(),name:'[合成持有，仅测试]浏览器耳机',brand:'Sony',model:'WH-CH520',category:'其他',lifecycle:'长期耐用',availability:'available',ownsConfirmed:true,synthetic:true}})).item;
 report.sources=[];
 for(const url of ['https://helpguide.sony.net/mdr/2958/v1/zh-cn/index.html','https://helpguide.sony.net/mdr/2958/v1/en/contents/TP1000783325.html']){try{const result=await post('/api/life',{action:'importOfficial',input:{itemId:item.id,url,confirmed:true}});report.sources.push({url,result});}catch(e){report.sources.push({url,error:e.message});}}
 await page.goto(base+'/#item/'+item.id);
 const region=page.getByRole('region',{name:'物间统一对话',exact:true});await region.waitFor();
 async function ask(question){const started=performance.now();const response=page.waitForResponse(r=>r.url().endsWith('/api/assistant')&&r.request().method()==='POST'&&!r.request().postDataJSON()?.action,{timeout:140000});
  await region.locator('textarea[name="question"]').fill(question);await region.getByRole('button',{name:'发送',exact:true}).click();
  const result=await assistantResponse(await response);report.responses.push({question,result,elapsedMs:Math.round(performance.now()-started)});save();return result;
 }
 const first=await ask('WH-CH520短按音量减和长按音量减有什么不同？请都说。');
 await expect(region.getByText(first.reply.answer,{exact:true})).toBeVisible({timeout:10000});
 await page.screenshot({path:dir+'/live-v3-desktop.png',fullPage:false});report.checks.push({name:'桌面UI→真实模型→最终完整回复渲染（内容质量单独审阅）',passed:true});
 await region.getByRole('button',{name:'开始新问题',exact:true}).click();
 const second=await ask('WH-CH520恢复出厂初始化要按什么键、多久？配对信息会怎样？');
 await page.setViewportSize({width:390,height:844});await region.scrollIntoViewIfNeeded();
 await expect(region.getByText(second.reply.answer,{exact:true})).toBeVisible({timeout:10000});
 await page.screenshot({path:dir+'/live-v3-mobile.png',fullPage:false});report.checks.push({name:'390px新会话→真实模型→最终回复呈现（非实物操作验证）',passed:true});
 report.horizontalOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);if(report.horizontalOverflow)report.errors.push('horizontal_overflow');
}catch(e){report.errors.push(e.message);await page.screenshot({path:dir+'/live-v3-failure.png'}).catch(()=>{});process.exitCode=1;}
finally{report.upstreamRequests=ledger().length-before;report.attempts=ledger().slice(before).map(a=>a.number);save();await browser.close();console.log(JSON.stringify({checks:report.checks,errors:report.errors,upstreamRequests:report.upstreamRequests}));}
