import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {observeAssistant,ask} from '../practical/browser-helpers.mjs';
import {ROOT} from './gateway.mjs';
const attempt=process.argv.find(x=>x.startsWith('--attempt='))?.slice(10)||'r3';assert.match(attempt,/^r\d+$/);
const caseId=process.argv.find(x=>x.startsWith('--case='))?.slice(7)||'A';assert.ok(['A','B'].includes(caseId));const title=caseId==='A'?'今晚，写一页旅行手账':'给那幅画，找一个新位置';const followup=caseId==='A'?'我改主意了，不写手账，改成把桌面留空后静坐十分钟；不要音箱，也不重新布置画。台灯怎样手动调亮度？我没有授权你控制设备。':'先不要安排放置画作，我还没确认画框支撑。请只解释这幅画的已记录来历，以及还有哪些私人事实没有记录；不要帮我编故事或另存记忆。';const file=ROOT+'/home-'+caseId+'-retest-'+attempt+'.json';assert.ok(!fs.existsSync(file));
const ledger=()=>JSON.parse(fs.readFileSync(ROOT+'/model-calls.json'));const before=ledger().attempts.length;
const report={at:new Date().toISOString(),basis:'real_Qwen_real_browser_DEVELOPMENT_RETEST_existing_r2_synthetic_account_and_official_cache_NOT_new_discovery_NOT_hardware_original_first_answers_retained',responses:[],checks:[],errors:[],pageErrors:[]};
const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));save();
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true}),context=await browser.newContext({storageState:'.runtime/finals-home-journeys-r2-state.json',viewport:{width:1440,height:1000}});await observeAssistant(context);const page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));
try{
 await page.goto('http://127.0.0.1:3242');await page.getByRole('button',{name:'生活首页',exact:true}).waitFor();
 const home=page.getByRole('region',{name:'虚拟年轻人公寓',exact:true});await expect(home).toContainText('正在模拟家庭中');
 await page.getByRole('navigation',{name:'主要导航',exact:true}).getByRole('button',{name:'问物间',exact:true}).click();const read=page.getByLabel('使用已获准的个人记忆与经历（仅使用允许云端读取的内容，不自动保存新记忆）',{exact:true});await read.check();
 await page.getByRole('button',{name:'生活首页',exact:true}).click();const count=await page.evaluate(()=>window.__assistantResults.length),start=performance.now();
 await home.getByRole('button').filter({has:page.getByRole('heading',{name:title,exact:true})}).click();
 await page.waitForFunction(n=>window.__assistantResults.length>n,count,{timeout:180000});const captured=await page.evaluate(()=>window.__assistantResults.at(-1));assert.ok(captured.result?.reply,JSON.stringify(captured.result));report.responses.push({kind:'entry_retest',result:captured.result,fullAnswerMs:Math.round(performance.now()-start),streamTextEvents:captured.textEvents});save();
 await expect(page.getByRole('region',{name:'物间统一对话',exact:true}).locator('.assistant-prose').last()).toBeVisible();await page.screenshot({path:ROOT+'/home-'+caseId+'-'+attempt+'-desktop.png'});
 const follow=await ask(page,followup,report);report.responses.at(-1).kind='followup_retest';assert.equal(follow.session.id,captured.result.session.id);save();
 await page.setViewportSize({width:390,height:844});await page.getByRole('region',{name:'物间统一对话',exact:true}).locator('.assistant-prose').last().scrollIntoViewIfNeeded();await page.screenshot({path:ROOT+'/home-'+caseId+'-'+attempt+'-mobile.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
 report.checks.push({name:'same_session_and_mobile_layout_protocol_only',passed:true});report.status='executed_needs_independent_criterion_review_NOT_quality_verdict';
}catch(e){report.status='failed';report.errors.push(e.message);process.exitCode=1;await page.screenshot({path:ROOT+'/home-'+caseId+'-'+attempt+'-failure.png'}).catch(()=>{});}
finally{report.upstreamRequests=ledger().attempts.length-before;save();await browser.close();console.log(JSON.stringify({status:report.status,requests:report.upstreamRequests,errors:report.errors}));}
