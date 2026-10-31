import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
const base='http://127.0.0.1:3227',dir='docs/engineering/real-intelligence-2026-10-31/evidence';
const ledger=()=>JSON.parse(fs.readFileSync(dir+'/model-calls.json','utf8')).attempts;
const before=ledger().length;
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
const report={at:new Date().toISOString(),synthetic:true,physicalTests:0,checks:[],errors:[],responses:[]};
page.on('pageerror',e=>report.errors.push(e.message));
const save=()=>fs.writeFileSync(dir+'/browser-live.json',JSON.stringify(report,null,2));
async function post(url,data){const r=await page.request.post(base+url,{data});const d=await r.json();if(!r.ok())throw Error(JSON.stringify({url,status:r.status(),error:d.error}));return d;}
try{
 await page.goto(base);await page.getByLabel('用户名',{exact:true}).fill('模型浏览器'+Date.now());await page.getByLabel('口令',{exact:true}).fill(randomBytes(18).toString('hex'));await page.getByRole('checkbox').check();await page.getByRole('button',{name:'进入我的物间',exact:true}).click();await page.getByRole('button',{name:'生活首页',exact:true}).waitFor();
 const item=(await post('/api/life',{action:'createItem',input:{requestId:randomUUID(),name:'[合成持有]浏览器耳机',brand:'Sony',model:'WH-CH520',category:'其他',lifecycle:'长期耐用',availability:'available',ownsConfirmed:true,synthetic:true}})).item;
 for(const url of ['https://helpguide.sony.net/mdr/2958/v1/en/contents/TP1000776852.html','https://helpguide.sony.net/mdr/2958/v1/en/contents/TP1000783325.html'])await post('/api/life',{action:'importOfficial',input:{itemId:item.id,url,confirmed:true}});
 await page.goto(base+'/#item/'+item.id);
 const region=page.getByRole('region',{name:'物间统一对话',exact:true});await region.waitFor();
 async function ask(question){const started=performance.now();const response=page.waitForResponse(r=>r.url().endsWith('/api/assistant')&&r.request().method()==='POST'&&!r.request().postDataJSON()?.action,{timeout:100000});
  await region.locator('textarea[name="question"]').fill(question);await region.getByRole('button',{name:'发送',exact:true}).click();
  const r=await response;const body=await r.text();let result;
  for(const frame of body.split('\n\n'))if(frame.startsWith('event: result'))result=JSON.parse(frame.match(/^data: (.+)$/m)[1]);
  if(!result)throw Error('no_final_sse_result');
  report.responses.push({question,result:result.reply,modelCalls:result.modelCalls,tokens:result.tokens,elapsedMs:Math.round(performance.now()-started)});save();return result;
 }
 const first=await ask('这耳机已经配对过旧手机，如何配对另一台手机？');
 if(!JSON.stringify(first.reply.steps).includes('5'))throw Error('missing_five_second_pairing');
 await expect(region.getByText(/5秒/).first()).toBeVisible();await page.screenshot({path:dir+'/live-answer-desktop.png',fullPage:false});report.checks.push({name:'桌面真实UI发送→真实千问→SSE最终结果→5秒配对步骤呈现',passed:true});
 await region.getByRole('button',{name:'开始新问题',exact:true}).click();const second=await ask('WH-CH520如何操作恢复出厂初始化，按什么键、多久，配对信息会怎样？');
 const text=JSON.stringify(second.reply.steps);if(!text.includes('10')||!text.includes('配对'))throw Error('initialization_not_complete');
 await page.setViewportSize({width:390,height:844});await region.scrollIntoViewIfNeeded();await page.screenshot({path:dir+'/live-answer-mobile.png',fullPage:false});
 report.checks.push({name:'新会话10秒初始化步骤渲染；390px页面读取同一真实回答（不认证全问题覆盖）',passed:true});
 report.horizontalOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);
 if(report.horizontalOverflow)report.errors.push('horizontal_overflow');
}catch(e){report.errors.push(e.message);fs.writeFileSync('.runtime/browser-live-failure-dom.txt',await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:dir+'/live-browser-failure.png'}).catch(()=>{});process.exitCode=1;}
finally{report.upstreamRequests=ledger().length-before;report.attempts=ledger().slice(before).map(a=>a.number);save();await browser.close();console.log(JSON.stringify({checks:report.checks,errors:report.errors,upstreamRequests:report.upstreamRequests}));}
