import {chromium,expect} from '@playwright/test';import fs from 'node:fs';import assert from 'node:assert/strict';
import {ROOT} from './gateway.mjs';
const base='http://127.0.0.1:3242',file=ROOT+'/state-browser-r1.json';assert.ok(!fs.existsSync(file));
const seed=JSON.parse(fs.readFileSync(ROOT+'/persona-browser-r3.json'));
const report={at:new Date().toISOString(),basis:'real_browser_deterministic_personal_state_edit_and_shared_Reality_no_model_request',checks:[],errors:[],pageErrors:[]};const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));save();
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});const context=await browser.newContext({storageState:'.runtime/finals-persona-r3-state.json',viewport:{width:1440,height:1000}});const page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));
await page.route('**/api/assistant',async route=>{if(route.request().method()==='POST')throw Error('this_runner_must_not_generate');await route.continue();});
try{
 await page.goto(base+'/#item/'+seed.deskId);await page.getByRole('button',{name:'资料与管理',exact:true}).click();
 const form=page.locator('form').filter({has:page.getByRole('button',{name:'保存管理信息',exact:true})});await page.getByText('更新数量、有效期和养护信息',{exact:true}).click();
 const before=await(await context.request.get(base+'/api/life?itemId='+seed.deskId)).json();report.before={revision:before.reality.revision,dimensions:before.reality.facts.find(f=>f.predicate==='dimensions')};
 const dimensions='本人更正：桌面宽55厘米、深35厘米；承重未测（合成数据）';await form.getByLabel('尺寸 / 结构（本人记录）',{exact:true}).fill(dimensions);
 const write=page.waitForResponse(r=>r.url()===base+'/api/life'&&r.request().method()==='POST'&&r.request().postDataJSON()?.action==='updateItem');await form.getByRole('button',{name:'保存管理信息',exact:true}).click();assert.ok((await write).ok());
 const detail=page.locator('section.life-card').filter({has:page.getByRole('heading',{name:'物品资料与属性',exact:true})});await expect(detail.locator('dl')).toContainText(dimensions);
 const after=await(await context.request.get(base+'/api/life?itemId='+seed.deskId)).json();const fact=after.reality.facts.find(f=>f.predicate==='dimensions');assert.equal(fact.value,dimensions);assert.equal(fact.basis,'user_report');assert.notEqual(after.reality.revision,before.reality.revision);report.after={revision:after.reality.revision,dimensions:fact};report.checks.push({name:'UI_correction_updates_shared_Reality_revision_and_user_report_basis',passed:true});
 await page.reload();await page.getByRole('button',{name:'资料与管理',exact:true}).click();await page.getByText('更新数量、有效期和养护信息',{exact:true}).click();await expect(page.getByLabel('尺寸 / 结构（本人记录）',{exact:true})).toHaveValue(dimensions);report.checks.push({name:'corrected_dimensions_survive_reload_not_ephemeral_UI_state',passed:true});
 await page.screenshot({path:ROOT+'/state-r1-desktop.png'});await page.setViewportSize({width:390,height:844});await page.getByLabel('尺寸 / 结构（本人记录）',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:ROOT+'/state-r1-mobile.png'});report.horizontalOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);assert.equal(report.horizontalOverflow,false);
 report.status='passed_deterministic_UI_and_persistence_only';
}catch(e){report.status='failed';report.errors.push(e.message);process.exitCode=1;await page.screenshot({path:ROOT+'/state-r1-failure.png'}).catch(()=>{});}
finally{save();await browser.close();console.log(JSON.stringify({status:report.status,checks:report.checks,errors:report.errors}));}
