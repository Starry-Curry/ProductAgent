import {chromium,expect} from '@playwright/test';import fs from 'node:fs';import assert from 'node:assert/strict';import {ROOT} from './gateway.mjs';
const base='http://127.0.0.1:3242',stage=process.argv.find(a=>a.startsWith('--attempt='))?.slice(10)||'r1';assert.match(stage,/^r\d+$/);const file=ROOT+'/task-race-browser-'+stage+'.json';assert.ok(!fs.existsSync(file));
const itemId=JSON.parse(fs.readFileSync(ROOT+'/software-browser-r1.json')).itemId;
const report={at:new Date().toISOString(),basis:'real_authenticated_synthetic_Task_APIs_and_browser_with_delayed_original_HTTP_response_no_Qwen_no_fabricated_reply',checks:[],errors:[]};const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));save();
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});const context=await browser.newContext({storageState:'.runtime/finals-persona-r3-state.json',viewport:{width:1440,height:1000}});const page=await context.newPage();let release=()=>{};
await page.route('**/api/assistant',async r=>{if(r.request().method()==='POST'){await r.abort('blockedbyclient');return;}await r.continue();});
async function task(label){const r=await context.request.post(base+'/api/foundation',{data:{action:'create',input:{requestId:crypto.randomUUID(),goal:'[合成竞态]'+label+' '+stage,intent:'plan',itemInstanceIds:[itemId]}}});assert.ok(r.ok());return (await r.json()).task;}
try{
 const a=await task('旧目标A'),b=await task('新目标B');report.tasks={a:a.taskId,b:b.taskId};save();
 await page.goto(base+'/#home');const panel=page.getByTestId('task-continuity');if(await panel.getAttribute('open')===null)await panel.locator('summary').first().click();await panel.locator('button[data-task-id="'+a.taskId+'"]').click();await expect(panel.locator('summary').first()).toContainText(a.goal);
 let observed;const intercepted=new Promise(r=>observed=r),gate=new Promise(r=>release=r);let first=true;
 await page.route(base+'/api/foundation?taskId='+a.taskId,async route=>{if(!first){await route.continue();return;}first=false;const original=await route.fetch();observed();await gate;await route.fulfill({response:original});});
 await page.reload();await intercepted;if(await panel.getAttribute('open')===null)await panel.locator('summary').first().click();await panel.locator('button[data-task-id="'+b.taskId+'"]').click();await expect(panel.locator('summary').first()).toContainText(b.goal);
 const oldResponse=page.waitForResponse(r=>r.url()===base+'/api/foundation?taskId='+a.taskId);release();await oldResponse;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await expect(panel.locator('summary').first()).toContainText(b.goal,{timeout:1500});report.checks.push({name:'late_old_Task_response_does_not_replace_explicit_new_goal',passed:true});await page.screenshot({path:ROOT+'/task-race-'+stage+'-desktop.png'});report.status='passed_deterministic_UI_race';
}catch(e){report.status='failed';report.errors.push(e.message);process.exitCode=1;await page.screenshot({path:ROOT+'/task-race-'+stage+'-failure.png'}).catch(()=>{});}
finally{release();save();await browser.close();console.log(JSON.stringify({status:report.status,checks:report.checks,errors:report.errors}));}
