import {chromium,expect} from '@playwright/test';import fs from 'node:fs';
import {observeAssistant,ask} from '../practical/browser-helpers.mjs';import {ROOT} from './gateway.mjs';
const base='http://127.0.0.1:3242',name=process.argv.find(a=>a.startsWith('--attempt='))?.slice(10)||'r1';if(!/^r\d+$/.test(name))throw Error('invalid_attempt');
const file=ROOT+'/progress-browser-'+name+'.json';if(fs.existsSync(file))throw Error('preserve_first_and_retest');
const seed=JSON.parse(fs.readFileSync(ROOT+'/brother-browser-r2.json','utf8'));
const ledger=()=>JSON.parse(fs.readFileSync(ROOT+'/model-calls.json','utf8'));const start=ledger().attempts.length;
const report={at:new Date().toISOString(),basis:'real_Qwen_browser_cached_official_data_synthetic_possession_and_step_feedback_no_hardware',responses:[],checks:[],errors:[]};const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));save();
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});const context=await browser.newContext({storageState:'.runtime/finals-brother-r2-state.json',viewport:{width:1440,height:1000}});await observeAssistant(context);const page=await context.newPage();
try{
 await page.goto(base+'/#item/'+seed.item.id);const region=page.getByRole('region',{name:'物间统一对话',exact:true});await region.waitFor();
 await region.getByText('继续以前的问题 / 提问选项',{exact:true}).click();await region.locator('.conversation-options select').first().selectOption('');
 const first=await ask(page,'请按官方说明分步骤教我安装电池和标签带，并说明关盖前检查什么。只讲这些操作，不恢复出厂。这里是模拟持有，只验证阅读与反馈。',report);save();
 if(!first.reply.steps.length)throw Error('No actionable step identities returned');
 const feedback=page.waitForResponse(r=>r.url()===base+'/api/assistant'&&r.request().method()==='POST'&&r.request().postDataJSON()?.action==='feedback');
 await region.getByRole('button',{name:'这步试过了',exact:true}).first().click();const updated=await(await feedback).json();
 if(!updated.session.tried.includes(first.reply.steps[0].id))throw Error('step_feedback_not_saved');
 report.checks.push({name:'explicit_synthetic_step_report_persisted',passed:true});save();
 const prior=ledger().attempts.length,second=await ask(page,'下一步呢？',report);save();
 report.checks.push({name:'same_session',passed:second.session.id===first.session.id},{name:'pure_progress_no_extra_model_request',passed:ledger().attempts.length===prior},{name:'remaining_step_count',passed:second.reply.steps.length===first.reply.steps.length-1});
 if(second.session.id!==first.session.id||ledger().attempts.length!==prior||second.reply.steps.length!==first.reply.steps.length-1)throw Error('progress_contract_failed');
 await expect(region.locator('.assistant-prose').last()).toContainText('不代表设备已实际完成');
 await page.screenshot({path:ROOT+'/progress-'+name+'-desktop.png'});await page.setViewportSize({width:390,height:844});await region.locator('.assistant-prose').last().scrollIntoViewIfNeeded();await page.screenshot({path:ROOT+'/progress-'+name+'-mobile.png'});
 report.status='passed_execution_and_progress_quality_requires_manual_review';
}catch(e){report.status='failed';report.errors.push(e.message);process.exitCode=1;await page.screenshot({path:ROOT+'/progress-'+name+'-failure.png'}).catch(()=>{});}
finally{report.upstreamRequests=ledger().attempts.length-start;save();await browser.close();console.log(JSON.stringify({status:report.status,requests:report.upstreamRequests,checks:report.checks,errors:report.errors}));}
