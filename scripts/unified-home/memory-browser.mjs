import {chromium,expect} from "@playwright/test";
import fs from "node:fs";
const base=process.env.TEST_BASE_URL||"http://127.0.0.1:3204",out="artifacts/unified-home";
const b=await chromium.launch({executablePath:process.env.EDGE_PATH||"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
const page=await b.newPage({viewport:{width:390,height:844}}),records=[],errors=[];page.on("pageerror",e=>errors.push(e.message));
const save=()=>fs.writeFileSync(out+"/memory-browser-live.json",JSON.stringify({at:new Date().toISOString(),records,errors},null,2));
async function send(question){const region=page.getByRole("region",{name:"物间统一对话",exact:true});const wait=page.waitForResponse(r=>r.url().endsWith("/api/assistant")&&r.request().method()==="POST"&&r.request().postDataJSON()?.question,{timeout:130000});await region.getByRole("textbox",{name:"对物间说",exact:true}).fill(question);await region.getByRole("button",{name:"发送",exact:true}).click();const r=await wait,d=await r.json();records.push({question,status:r.status(),result:d});save();if(!r.ok())throw Error(JSON.stringify(d));await expect(region.getByRole("button",{name:"发送",exact:true})).toBeEnabled();return d;}
async function home(){await page.getByRole("button",{name:"生活首页",exact:true}).click();}
async function painting(){await home();await page.locator(".apartment-item").filter({hasText:"远山"}).click();await page.locator(".memory-center > summary").click();}
try{
 await page.goto(base+"/#home");await page.getByLabel("演示家庭成员").selectOption("friend");
 if(await page.getByRole("button",{name:"打开模拟家庭",exact:false}).count()){
 await page.getByLabel("允许云端模型使用这套模拟家庭",{exact:false}).check();await page.getByRole("button",{name:"打开模拟家庭",exact:false}).click();await page.locator(".apartment-progress").filter({hasText:"本轮官网获取完成"}).waitFor({timeout:150000});
 }
 records.push({case:"separate-friend-synthetic-home-explicit-consent",items:await page.locator(".apartment-item h3").allTextContents()});
 await painting();const center=page.locator(".memory-center");const relation=center.locator("article.source-card").filter({hasText:"朋友小夏"});await relation.getByRole("button",{name:"纠正 / 调整授权",exact:true}).click();await center.locator("textarea[name=text]").fill("模拟纠正：这幅画是朋友小雨送给我的，赠送时间和其他关系细节未知。");const corrected=page.waitForResponse(r=>r.url().endsWith("/api/memories")&&r.request().method()==="POST");await center.getByRole("button",{name:"保存纠正",exact:true}).click();if(!(await corrected).ok())throw Error("Correction failed");
 await home();await page.getByRole("button",{name:"问物间",exact:true}).click();let d=await send("这幅画是谁送我的？请只使用当前获准的关系记忆，不补充日期或情感经历。");if(!d.reply.answer.includes("小雨")||d.reply.answer.includes("小夏"))throw Error("Incorrect corrected recall");await page.screenshot({path:out+"/memory-corrected-mobile.png",fullPage:true});
 await painting();const current=page.locator(".memory-center article.source-card").filter({hasText:"朋友小雨"});const forgotten=page.waitForResponse(r=>r.url().endsWith("/api/memories")&&r.request().method()==="DELETE");await current.getByRole("button",{name:"忘记",exact:true}).click();if(!(await forgotten).ok())throw Error("Forget failed");
 await home();await page.getByRole("button",{name:"问物间",exact:true}).click();d=await send("这幅画是谁送我的？没有获准记录就直接告诉我未知，不要从原故事补回。");if(d.reply.answer.includes("小雨")||d.reply.answer.includes("小夏"))throw Error("Forgotten relation resurfaced");await page.screenshot({path:out+"/memory-forgotten-mobile.png",fullPage:true});
 const denied=await page.request.get(base+"/api/memories?itemId=virtual-home%3Alin%3Apainting",{headers:{"x-demo-actor":"friend"}});const foreign=await denied.json();if(JSON.stringify(foreign.memories||[]).includes("小夏"))throw Error("Cross actor leak");records.push({case:"different-actor-never-receives-lin-relationship",status:denied.status()});
 console.log(JSON.stringify({cases:records.map(r=>({case:r.case||r.question,status:r.status})),errors}));
}catch(e){records.push({case:"failed",error:e.message});await page.screenshot({path:out+"/memory-failure.png",fullPage:true}).catch(()=>{});throw e;}
finally{save();await b.close();}
