import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
import {randomBytes} from 'node:crypto';
import {observeAssistant,ask,createUIItem} from '../practical/browser-helpers.mjs';
import {ROUND,ROOT} from './gateway.mjs';
const cases={
 brother:{name:'[模拟持有]我的标签机',brand:'Brother',model:'PT-D210',question:'请自己查找 Brother PT-D210 的官方资料。我装着6毫米TZe标签带，想打印两行文字，可以吗？如果不行，用哪些宽度才可以？这台机器要装几节什么电池？请完整回答，不要教我恢复出厂。',followup:'暂时不买新标签带，也不换机器。我只用现在的6毫米带，想把两行信息都保留下来，有什么可实际操作的替代安排？请不要声称机器已执行。'},
 hario:{name:'[模拟持有]透明手冲细口壶',brand:'HARIO',model:'VKA-35-TB',question:'请自己找到 HARIO VKA-35-TB 的官方资料。我想用它给手冲咖啡倒热水：实用容量多大？是什么材质？能否直接放燃气灶或者微波炉里把水加热？请分别回答，官方没说的不要猜。',followup:'那它能给我已有的小盆栽浇水吗？不要把它放到热源上，也不要要求购买配件。请区分可以借用的结构特性与需要我确认的条件。'},
};
const id=process.argv.find(x=>x.startsWith('--case='))?.slice(7)||'brother';
const attempt=process.argv.find(x=>x.startsWith('--attempt='))?.slice(10)||'r1';
if(!cases[id]||!/^r\d+$/.test(attempt))throw Error('invalid_case_or_attempt');
const spec=cases[id],base='http://127.0.0.1:3242';process.env.WUJIAN_TEST_URL=base;
const preview=JSON.parse(fs.readFileSync('.runtime/finals-preview-3242.json','utf8'));
if(preview.round!==ROUND||preview.syntheticDataOnly!==true||preview.paid!==true)throw Error('incorrect_test_preview');
const target=ROOT+'/'+id+'-browser-'+attempt+'.json';if(fs.existsSync(target))throw Error('preserve_first_and_retests');
const ledger=()=>JSON.parse(fs.readFileSync(ROOT+'/model-calls.json','utf8'));
const initial=ledger().attempts.length;
const report={caseId:id,attempt,at:new Date().toISOString(),basis:'real_Qwen_browser_synthetic_possession_no_official_URL_supplied_no_hardware',responses:[],pageErrors:[],checks:[],errors:[],quality:'not_scored'};
const save=()=>fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n');save();
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});await observeAssistant(context);const page=await context.newPage();
page.on('pageerror',e=>report.pageErrors.push(e.message));
try{
 await page.goto(base);await page.getByLabel('用户名',{exact:true}).fill('决赛独立测试'+Date.now());await page.getByLabel('口令',{exact:true}).fill(randomBytes(18).toString('hex'));
 await page.getByLabel('第一次使用，创建独立账号',{exact:true}).check();await page.getByRole('button',{name:'进入我的物间',exact:true}).click();await page.getByRole('button',{name:'生活首页',exact:true}).waitFor();
 await context.storageState({path:'.runtime/finals-'+id+'-'+attempt+'-state.json'});
 const item=await createUIItem(page,spec,report);report.item={id:item.id,model:item.model,brand:item.brand,synthetic:item.synthetic,supportUrl:item.supportUrl};
 if(item.supportUrl)throw Error('unexpected_preseeded_source');save();
 const result=await ask(page,spec.question,report);save();
 report.checks.push({name:'final_answer_visible',passed:!!result.reply.answer,quality:'requires_original_source_review'});
 const data=await(await context.request.get(base+'/api/life?itemId='+item.id)).json();
 report.sharedKnowledge={reality:data.reality,knowledge:data.knowledge};save();
 await page.screenshot({path:ROOT+'/'+id+'-'+attempt+'-desktop.png'});
 if(result.reply.outcome!=='unavailable'){
  const follow=await ask(page,spec.followup,report);save();report.checks.push({name:'same_session_continuation',passed:follow.session.id===result.session.id});
 }
 await page.setViewportSize({width:390,height:844});await page.getByRole('region',{name:'物间统一对话',exact:true}).locator('.assistant-prose').last().scrollIntoViewIfNeeded();
 await page.screenshot({path:ROOT+'/'+id+'-'+attempt+'-mobile.png'});
 report.checks.push({name:'no_horizontal_overflow',passed:await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)});
 report.status='executed_quality_requires_review';
}catch(e){report.status='failed';report.errors.push(e.message);await page.screenshot({path:ROOT+'/'+id+'-'+attempt+'-failure.png'}).catch(()=>{});fs.writeFileSync('.runtime/finals-'+id+'-'+attempt+'-dom.txt',await page.locator('body').innerText().catch(()=>''));process.exitCode=1;}
finally{report.upstreamRequests=ledger().attempts.length-initial;report.finishedAt=new Date().toISOString();save();await browser.close();console.log(JSON.stringify({caseId:id,attempt,status:report.status,upstreamRequests:report.upstreamRequests,checks:report.checks,errors:report.errors}));}
