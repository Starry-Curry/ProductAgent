import fs from 'node:fs';
import {chromium,expect} from '@playwright/test';
import {ROOT} from './gateway.mjs';
const stage=process.argv.find(a=>a.startsWith('--stage='))?.slice(8)||'release-browser';if(!/^[a-z0-9-]+$/.test(stage))throw Error('invalid_stage');
const file=ROOT+'/'+stage+'.json';if(fs.existsSync(file))throw Error('preserve_evidence');
const before=JSON.parse(fs.readFileSync(ROOT+'/model-calls.json')).attempts.length;
const report={at:new Date().toISOString(),basis:'final_production_build_existing_synthetic_task_resume_no_new_model',checks:[],pageErrors:[]};
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const context=await browser.newContext({storageState:'.runtime/practical-browser-state.json',viewport:{width:1440,height:1000}});
const page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));
try{
 const auth=page.waitForResponse(r=>r.url().endsWith('/api/account')&&r.request().method()==='GET');await page.goto('http://127.0.0.1:3233/');
 if(!(await(await auth).json()).account){const login=JSON.parse(fs.readFileSync('.runtime/continuation-fixture-login.json'));await page.getByLabel('用户名',{exact:true}).fill(login.name);await page.getByLabel('口令',{exact:true}).fill(login.password);await page.getByRole('button',{name:'进入我的物间',exact:true}).click();}
 await page.getByRole('button',{name:'生活首页',exact:true}).waitFor();await page.goto('http://127.0.0.1:3233/#assistant');
 const taskId=JSON.parse(fs.readFileSync(ROOT+'/cross-bound-final.json')).responses[0].result.foundation.taskId;
 const widget=page.getByTestId('task-continuity');await widget.locator('summary').first().click();
 if(!await widget.locator('[data-task-id="'+taskId+'"]').count())await widget.getByRole('button',{name:'查看较早的事',exact:true}).click();
 await widget.locator('[data-task-id="'+taskId+'"]').click();
 await expect(widget.locator('h3').first()).toContainText('Osmo Mobile 6');
 report.checks.push({name:'最终生产构建可展开并打开较早的同一Task',passed:true});
 // Earlier conversation context was intentionally invalidated by subsequent
 // forget/revoke tests. Do not bypass that privacy boundary for a screenshot.
 const latest=JSON.parse(fs.readFileSync(ROOT+'/natural-story-final.json')).confirmation.taskId;
 await widget.locator('[data-task-id="'+latest+'"]').click();
 const answer=page.locator('.assistant-prose').last();await expect(answer).toContainText('合成');
 report.checks.push({name:'未失效的故事Task可恢复原真实模型对话',passed:true});
 if(await widget.evaluate(el=>el.open))await widget.locator('summary').first().click();
 await answer.evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:ROOT+'/'+stage+'-desktop.png'});
 await answer.screenshot({path:ROOT+'/'+stage+'-answer.png'});
 await page.setViewportSize({width:390,height:844});await answer.evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:ROOT+'/'+stage+'-mobile.png'});
 report.mobileOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);
 await context.storageState({path:'.runtime/practical-browser-state.json'});
 if(report.mobileOverflow||report.pageErrors.length)throw Error('release_browser_failed');
}catch(e){report.error=e.message;report.visibleText=await page.locator('body').innerText().catch(()=>'');await page.screenshot({path:ROOT+'/'+stage+'-failure.png'}).catch(()=>{});process.exitCode=1;}
finally{report.newModelRequests=JSON.parse(fs.readFileSync(ROOT+'/model-calls.json')).attempts.length-before;fs.writeFileSync(file,JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report));}
