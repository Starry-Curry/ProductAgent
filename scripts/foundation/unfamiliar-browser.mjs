import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {observeAssistant,ask,createUIItem} from '../practical/browser-helpers.mjs';

// Development item, independently checked not to overlap the frozen SKU set.
// No product URL, answer, or operation fixture is supplied to the application.
const root='docs/engineering/qwen-foundation-2026-11-02/evidence';
const stage=process.argv.find(a=>a.startsWith('--stage='))?.slice(8)||'unfamiliar-srs-xb100-r1';
if(!/^unfamiliar-srs-xb100-r[1-9]$/.test(stage))throw Error('invalid_stage');
const file=root+'/'+stage+'.json';if(fs.existsSync(file))throw Error('preserve_existing_evidence');
const before=JSON.parse(fs.readFileSync(root+'/model-calls.json')).attempts.length;
process.env.WUJIAN_TEST_URL='http://127.0.0.1:3241';
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const context=await browser.newContext({storageState:'.runtime/foundation-browser-state.json',viewport:{width:1440,height:1000}});
await observeAssistant(context);const page=await context.newPage();
const report={at:new Date().toISOString(),basis:'real_Qwen_and_browser_development_not_frozen_acceptance',syntheticOwnership:true,providedProductURL:false,physicalDeviceOperations:0,responses:[],checks:[],errors:[],pageErrors:[]};
const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
page.on('pageerror',e=>report.pageErrors.push(e.message));
try{
 const item=await createUIItem(page,{name:'[模拟持有]旅行小音箱',brand:'Sony',model:'SRS-XB100'},report);
 report.item={id:item.id,model:item.model,synthetic:item.synthetic,supportUrl:item.supportUrl};
 assert.equal(item.model,'SRS-XB100');assert.ok(!item.supportUrl,'fixture must not seed an official URL');save();
 const first=await ask(page,'这台SRS-XB100以前连接过别的手机，我想改连现在的手机。请自主查它的官方资料，讲清进入配对模式、手机怎么选、怎样知道连好了。不要初始化或删除旧数据。',report);save();
 assert.equal(first.reply.outcome,'answered');
 assert.ok(first.reply.citations.some(c=>/sony\.(net|com)/.test(new URL(c.url).hostname)),'official acquired source missing');
 assert.ok(first.trace.some(t=>t.stage==='practical_search'),'unseeded discovery must actually execute upstream search');
 assert.ok(first.trace.some(t=>t.stage==='practical_tool'&&t.detail==='complete_answer completed'));
 report.checks.push({name:'UI model entry → unseeded official discovery → model final response',passed:true,semanticQuality:'requires_original_source_review'});
 await page.screenshot({path:root+'/'+stage+'-desktop.png'});
 const follow=await ask(page,'那我下次只想连接刚配对成功的这台手机，还需要每次重新进入配对模式吗？请只根据这台型号已取得的资料回答。',report);save();
 assert.equal(follow.reply.outcome,'answered');
 assert.ok(follow.reply.usedItems.some(i=>i.id===item.id));
 report.checks.push({name:'same item and conversation follow-up retains identity',passed:true,semanticQuality:'requires_original_source_review'});
 await page.setViewportSize({width:390,height:844});const region=page.getByRole('region',{name:'物间统一对话',exact:true});await region.locator('.assistant-prose').last().scrollIntoViewIfNeeded();await expect(region.locator('.assistant-prose').last()).toBeVisible();
 await page.screenshot({path:root+'/'+stage+'-mobile.png'});
 fs.writeFileSync('.runtime/foundation-unfamiliar-item.json',JSON.stringify({itemId:item.id}));
}catch(e){report.errors.push(e.message);await page.screenshot({path:root+'/'+stage+'-failure.png'}).catch(()=>{});process.exitCode=1;}
finally{report.upstreamRequests=JSON.parse(fs.readFileSync(root+'/model-calls.json')).attempts.length-before;save();await browser.close();console.log(JSON.stringify({checks:report.checks,errors:report.errors,upstreamRequests:report.upstreamRequests}));}
