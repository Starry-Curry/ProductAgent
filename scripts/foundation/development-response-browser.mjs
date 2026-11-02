import {chromium,expect} from '@playwright/test';import fs from 'node:fs';import assert from 'node:assert/strict';
import {observeAssistant,ask} from '../practical/browser-helpers.mjs';
const root='docs/engineering/qwen-foundation-2026-11-02/evidence',stage=process.argv.find(a=>a.startsWith('--stage='))?.slice(8)||'runtime-final-response-r1',file=root+'/'+stage+'.json';if(fs.existsSync(file))throw Error('preserve_existing_evidence');
if(!/^runtime-final-response-r[1-9]$/.test(stage))throw Error('invalid_stage'); const before=JSON.parse(fs.readFileSync(root+'/model-calls.json')).attempts.length;
const purpose=process.argv.find(a=>a.startsWith('--purpose='))?.slice(10)||'pairing';if(!['pairing','live-page'].includes(purpose))throw Error('invalid_purpose');
const {sonyItemId}=JSON.parse(fs.readFileSync('.runtime/foundation-browser-item.json'));
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const context=await browser.newContext({storageState:'.runtime/foundation-browser-state.json',viewport:{width:1440,height:1000}});await observeAssistant(context);const page=await context.newPage();
const report={at:new Date().toISOString(),basis:'real_Qwen_and_browser_existing_development_item_not_frozen_acceptance',syntheticOwnership:true,realHardwareOperations:0,responses:[],errors:[],checks:[],pageErrors:[]};page.on('pageerror',e=>report.pageErrors.push(e.message));
try{
 await page.goto('http://127.0.0.1:3241/#item/'+sonyItemId);const region=page.getByRole('region',{name:'物间统一对话',exact:true});await region.waitFor();
 const fresh=region.getByRole('button',{name:'开始新问题',exact:true});if(await fresh.count())await fresh.click();
 const r=await ask(page,purpose==='live-page'?'请实时重新读取这副WH-CH520已经取得的官方配对网页，只核对进入配对模式时蓝色指示灯怎样闪烁、语音提示是什么。不要扩展其他操作或复位。':'这副WH-CH520以前连接过另一台手机，现在怎样重新配对新手机？请只讲这项操作的完整步骤。',report);
 assert.equal(r.reply.outcome,'answered','UI/API returned is not sufficient; guidance must complete the bounded contract');
 assert.ok(r.trace.some(t=>t.stage==='practical_tool'&&t.detail==='complete_answer completed'));
 assert.ok(!r.trace.some(t=>t.stage==='practical_tool_failed'||t.stage==='practical_failed'));
 assert.ok(r.reply.citations.some(c=>c.url.includes('helpguide.sony.net')));
 assert.doesNotMatch(r.reply.answer,/PAIRING.{0,6}按钮|右耳罩.{0,20}边缘|恢复出厂|初始化方法/,'known previous unsupported/excess operation must not recur');
 if(purpose==='live-page')assert.ok(r.trace.some(t=>t.stage==='native_extraction'&&/web_extractor/.test(t.detail)),'must retain real native extractor event, not merely cached answer or HTTP success');
 report.checks.push({name:'final_function_contract_and_known_failure_regression',passed:true,caveat:'Transport and known-failure checks; independent human source/answer review still required.'});
 await page.screenshot({path:root+'/'+stage+'-desktop.png'});await page.setViewportSize({width:390,height:844});await region.locator('.assistant-prose').last().scrollIntoViewIfNeeded();await expect(region.locator('.assistant-prose').last()).toBeVisible();await page.screenshot({path:root+'/'+stage+'-mobile.png'});
}catch(e){report.errors.push(e.message);await page.screenshot({path:root+'/'+stage+'-failure.png'}).catch(()=>{});process.exitCode=1;}
finally{report.upstreamRequests=JSON.parse(fs.readFileSync(root+'/model-calls.json')).attempts.length-before;fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');await browser.close();console.log(JSON.stringify({checks:report.checks,errors:report.errors,upstreamRequests:report.upstreamRequests}));}
