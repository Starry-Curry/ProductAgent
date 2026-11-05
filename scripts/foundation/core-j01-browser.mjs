import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';
import {observeAssistant,ask,createUIItem} from '../practical/browser-helpers.mjs';
const base='http://127.0.0.1:3241',root='docs/engineering/qwen-foundation-2026-11-02/evidence';
process.env.WUJIAN_TEST_URL=base;
const stage=process.argv.find(a=>a.startsWith('--stage='))?.slice(8)||'core-j01-discovery-r1';
assert.match(stage,/^core-j01-discovery-r\d+$/);const file=root+'/'+stage+'.json';assert.ok(!fs.existsSync(file),'preserve_first_and_retest');
const preview=JSON.parse(fs.readFileSync('.runtime/foundation-preview-3241.json'));assert.equal(preview.round,'qwen-foundation-20261103-r3');
const ledger=root+'/rounds/'+preview.round+'/model-calls.json',before=JSON.parse(fs.readFileSync(ledger)).attempts.length;
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});await observeAssistant(context);const page=await context.newPage();
const report={at:new Date().toISOString(),basis:'real_browser_Qwen_unknown_brand_no_product_URL_synthetic_ownership_no_hardware',responses:[],checks:[],errors:[],pageErrors:[]};const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');page.on('pageerror',e=>report.pageErrors.push(e.message));
try{
 await page.goto(base);await page.getByLabel('用户名',{exact:true}).fill('Core独立验收'+Date.now());await page.getByLabel('口令',{exact:true}).fill(randomBytes(18).toString('hex'));await page.getByRole('checkbox').check();await page.getByRole('button',{name:'进入我的物间',exact:true}).click();await page.getByRole('button',{name:'生活首页',exact:true}).waitFor();await context.storageState({path:'.runtime/core-j01-browser-state.json'});await context.storageState({path:'.runtime/'+stage+'-browser-state.json'});
 const item=await createUIItem(page,{name:'[模拟持有]旅行录音机',brand:'ZOOM',model:'H1essential'},report);report.item={id:item.id,brand:item.brand,model:item.model,synthetic:item.synthetic,supportUrl:item.supportUrl};assert.ok(!item.supportUrl);fs.writeFileSync('.runtime/core-j01-item.json',JSON.stringify({itemId:item.id}));save();
 const answer=await ask(page,'我这台 ZOOM H1essential 放包里容易误碰按键。请自主找到该型号官方说明，告诉我如何在继续录音时锁定按键、怎样解除、关机和锁定有什么不同。没有实物操作，只要阅读指导。',report);save();
 assert.equal(answer.reply.outcome,'answered');assert.ok(answer.trace.some(t=>t.stage==='practical_search'));
 assert.ok(answer.reply.citations.some(c=>new URL(c.url).hostname.endsWith('zoomcorp.com')));report.checks.push({name:'unknown brand actual native search and applicable official body used by Qwen',passed:true,requiresRawReview:true});
 const life=await(await context.request.get(base+'/api/life?itemId='+item.id)).json();report.shared={knowledge:life.knowledge,reality:life.reality};save();assert.ok(life.reality?.facts.some(f=>f.basis==='official_source'));assert.ok(life.reality.capabilities.some(c=>c.basis==='official_source'&&c.executable===false));report.checks.push({name:'selected original assertions and conditional capabilities persisted in public Reality API',passed:true});
 await page.screenshot({path:root+'/'+stage+'-desktop.png'});await page.setViewportSize({width:390,height:844});await page.getByRole('region',{name:'物间统一对话',exact:true}).locator('.assistant-prose').last().scrollIntoViewIfNeeded();await page.screenshot({path:root+'/'+stage+'-mobile.png'});
}catch(e){report.errors.push(e.message);await page.screenshot({path:root+'/'+stage+'-failure.png'}).catch(()=>{});fs.writeFileSync('.runtime/'+stage+'-dom.txt',await page.locator('body').innerText().catch(()=>''));process.exitCode=1;}
finally{report.upstreamRequests=JSON.parse(fs.readFileSync(ledger)).attempts.length-before;save();await browser.close();console.log(JSON.stringify({checks:report.checks,errors:report.errors,upstreamRequests:report.upstreamRequests}));}
