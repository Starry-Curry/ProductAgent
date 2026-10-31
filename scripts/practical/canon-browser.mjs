import {chromium} from '@playwright/test';import fs from 'node:fs';import {ROOT} from './gateway.mjs';import {observeAssistant,createUIItem,ask} from './browser-helpers.mjs';
const stage=process.argv.find(s=>s.startsWith('--stage='))?.slice(8)||'canon-browser-v1';if(!/^[a-z0-9-]+$/.test(stage)||fs.existsSync(ROOT+'/'+stage+'.json'))throw Error('unique_stage_required');
const report={at:new Date().toISOString(),syntheticOwnership:true,physicalTests:0,responses:[],checks:[],errors:[]},ledger=()=>JSON.parse(fs.readFileSync(ROOT+'/model-calls.json')).attempts,before=ledger().length;
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true}),context=await browser.newContext({storageState:'.runtime/practical-browser-state.json',viewport:{width:1440,height:1000}});await observeAssistant(context);const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
try{
 const item=await createUIItem(page,{name:'[模拟持有]照片小打印机',brand:'Canon',model:'SELPHY CP1500',url:'https://cam.start.canon/en/P001/manual/html/UG-01_Preparations_0030.html'},report);report.item={id:item.id,name:item.name,model:item.model};
 const first=await ask(page,'SELPHY CP1500装相纸时，光面朝哪边、最多放多少张、纸盒内盖和外盖各怎么处理？请完整回答。',report);
 if(!/18|十八/.test(first.reply.answer)||!/光面|光泽/.test(first.reply.answer)||!first.reply.citations.some(c=>c.url.includes('cam.start.canon')))throw Error('paper_guidance_or_official_source_missing');
 report.checks.push({name:'真实公开网页→型号核对→录入/官方摘录→工具检索→真实模型完整多问',passed:true});await page.screenshot({path:ROOT+'/canon-desktop.png',fullPage:false});
 const second=await ask(page,'那装19张会更省事吗？印过一面的纸还能重复使用吗？',report);if(!/19|十九/.test(second.reply.answer)||!/不能|不要|不可以|禁止|不建议/.test(second.reply.answer))throw Error('paper_limits_missing');
 await page.setViewportSize({width:390,height:844});await page.locator('.assistant-prose').last().scrollIntoViewIfNeeded();await page.screenshot({path:ROOT+'/canon-mobile.png',fullPage:false});report.checks.push({name:'同型号追问19张和重复用纸限制，桌面/390px真实UI',passed:true});
 const local=JSON.parse(fs.readFileSync('.runtime/practical-browser-item.json'));fs.writeFileSync('.runtime/practical-browser-item.json',JSON.stringify({...local,canonItemId:item.id}));
}catch(e){report.errors.push(e.message);fs.writeFileSync('.runtime/canon-failure-dom.txt',await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:ROOT+'/canon-failure.png'}).catch(()=>{});process.exitCode=1;}
finally{report.upstreamRequests=ledger().length-before;fs.writeFileSync(ROOT+'/'+stage+'.json',JSON.stringify(report,null,2)+'\n');await browser.close();console.log(JSON.stringify({checks:report.checks,errors:report.errors,upstreamRequests:report.upstreamRequests}));}
