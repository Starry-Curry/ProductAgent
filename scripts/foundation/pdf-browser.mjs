import {chromium} from '@playwright/test';import fs from 'node:fs';import assert from 'node:assert/strict';
import {observeAssistant,ask,createUIItem} from '../practical/browser-helpers.mjs';
const root='docs/engineering/qwen-foundation-2026-11-02/evidence',stage=process.argv.find(a=>a.startsWith('--stage='))?.slice(8)||'pdf-product-path-r1';
if(!/^pdf-product-path-r[1-9]$/.test(stage))throw Error('invalid_stage');const file=root+'/'+stage+'.json';if(fs.existsSync(file))throw Error('preserve_evidence');
// Use an actual source URL from the preserved native discovery event. This is
// explicitly a linked-document intake test, NOT another unseeded discovery.
const ledger=JSON.parse(fs.readFileSync(root+'/model-calls.json'));
const native=ledger.attempts.find(a=>a.number===37&&a.kind==='responses_search');
const url=native?.output?.flatMap(i=>i.type==='web_search_call'?i.action?.sources||[]:[]).find(s=>s.url==='https://helpguide.sony.net/speaker/7856/v1/en/print.pdf')?.url;
assert.ok(url,'real native-discovered PDF required');const before=ledger.attempts.length;
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true}),context=await browser.newContext({storageState:'.runtime/foundation-browser-state.json',viewport:{width:1440,height:1000}});await observeAssistant(context);const page=await context.newPage();process.env.WUJIAN_TEST_URL='http://127.0.0.1:3241';
const report={at:new Date().toISOString(),basis:'real_Qwen_file_URL_via_Chat_not_Responses_browser_test',syntheticOwnership:true,providedProductURL:true,URLOrigin:'native search #37 structured sources, not model prose',physicalDeviceOperations:0,responses:[],checks:[],errors:[],pageErrors:[]};const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');page.on('pageerror',e=>report.pageErrors.push(e.message));
try{
 const item=await createUIItem(page,{name:'[模拟持有·PDF通路]旅行音箱',brand:'Sony',model:'SRS-XB100',url},report);report.item={id:item.id,model:item.model};save();
 const result=await ask(page,'请实际读取这台型号已经导入的官方PDF说明书，包括图示。核对它的型号、充电线应连接哪个接口，以及充电时盖子和防水有哪些注意条件。请指出来源，不要只根据已有文字层猜图，不要扩展复位或拆机。',report);save();
 assert.ok(result.trace.some(t=>t.stage==='manual_visual'&&JSON.parse(t.detail).kind==='pdf'),'no actual provider PDF read event');
 assert.equal(result.reply.outcome,'answered');assert.ok(result.reply.citations.some(c=>c.url===url));
 report.checks.push({name:'UI official PDF intake → actual Chat file_url read → source-linked answer',passed:true,semanticQuality:'requires independent original PDF/figure review, event success alone insufficient'});
 await page.screenshot({path:root+'/'+stage+'-desktop.png'});await page.setViewportSize({width:390,height:844});await page.getByRole('region',{name:'物间统一对话',exact:true}).locator('.assistant-prose').last().scrollIntoViewIfNeeded();await page.screenshot({path:root+'/'+stage+'-mobile.png'});
}catch(e){report.errors.push(e.message);await page.screenshot({path:root+'/'+stage+'-failure.png'}).catch(()=>{});process.exitCode=1;}
finally{report.upstreamRequests=JSON.parse(fs.readFileSync(root+'/model-calls.json')).attempts.length-before;save();await browser.close();console.log(JSON.stringify({checks:report.checks,errors:report.errors,upstreamRequests:report.upstreamRequests}));}
