import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:3147';
const out='review-evidence/screenshots';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.REVIEW_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const pages=[['01-help','使用帮助'],['02-plan','活动准备'],['03-family','家庭事项'],['04-discover','发现'],['05-gifts','礼物与记忆']];
const report={base,kind:'synthetic-local-demo-no-real-model',screens:[],pageErrors:[]};
try{
 for(const [device,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
  const page=await browser.newPage({viewport:{width,height}});page.on('pageerror',e=>report.pageErrors.push(e.message));
  await page.goto(base);await page.getByText('我希望怎样获得帮助 · 私人偏好',{exact:true}).waitFor();
  await page.screenshot({path:`${out}/${device}-00-home.png`,fullPage:true});
  report.screens.push({file:`${device}-00-home.png`,width,height,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)});
  for(const [key,label] of pages){
   await page.getByRole('button',{name:label,exact:true}).click();
   await page.waitForTimeout(200);
   if(label==='发现') {await page.getByRole('button',{name:'核对可用组合'}).click();await page.getByRole('heading',{name:'室内收纳与音乐角',exact:true}).waitFor();}
   await page.screenshot({path:`${out}/${device}-${key}.png`,fullPage:true});
   report.screens.push({file:`${device}-${key}.png`,width,height,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)});
  }
  await page.close();
 }
 const headers={'x-demo-actor':'friend','Content-Type':'application/json'};
 const state=await (await fetch(base+'/api/workspace',{headers})).json();
 const item=state.items.find(i=>i.name.startsWith('Integration M185'));
 const input={itemId:item.id,question:'电池规格是什么？',mode:'service'};
 const r=await fetch(base+'/api/ai',{method:'POST',headers,body:JSON.stringify(input)});
 const result=await r.json();
 const replay=await (await fetch(base+`/api/service-runs?runId=${result.run.id}&replay=1`,{headers})).json();
 writeFileSync('review-evidence/agent-failure-example.json',JSON.stringify({kind:'synthetic-input-real-local-api-no-model',input,httpStatus:r.status,result,replay},null,2));
}finally{await browser.close();}
writeFileSync('review-evidence/screenshots.json',JSON.stringify(report,null,2));
if(report.pageErrors.length||report.screens.some(s=>s.overflow))throw Error('Browser verification failed');
console.log(JSON.stringify(report,null,2));

