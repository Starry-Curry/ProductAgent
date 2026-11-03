// Preparation/default: print the concrete UI plan without opening a browser.
// Execute zero-model domain journeys against the synthetic local preview only:
// node scripts/foundation/gate3-relations-gift-browser.mjs --execute-browser --stage=gate3-relations-gift-r1
// This script NEVER opts into paid chat, visual inference or automatic search.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import sharp from 'sharp';

const ROOT='docs/engineering/qwen-foundation-2026-11-02/evidence';
const requestedBase=process.argv.find(a=>a.startsWith('--base='))?.slice(7)||'http://127.0.0.1:3241';
const baseURL=new URL(requestedBase);
assert.ok(baseURL.protocol==='http:'&&baseURL.hostname==='127.0.0.1'&&baseURL.port&&baseURL.pathname==='/'&&!baseURL.search&&!baseURL.hash,'synthetic_loopback_preview_required');
const base=baseURL.origin;
const stage=process.argv.find(a=>a.startsWith('--stage='))?.slice(8)||'gate3-relations-gift-r1';
if(!/^[a-z0-9-]+$/.test(stage))throw Error('invalid_evidence_stage');
const target=path.resolve(ROOT,stage+'.json');
const plan={base,modelRequestsInThisScript:0,paidEndpoints:'blocked before browser network',
 journeys:['UI注册两个独立账号→无品牌/型号纪念画录入和合成照片→UI故事保存→明确确认本机关系记忆→UI纠正→UI遗忘',
  'UI选择赠礼故事→UI预览并制作→另一个真实注册账号预览和确认模拟取得→独立物品实例→收礼人新增私事→API读取断言双向隐私'],
 limits:['没有真实实物取得；认领为明确合成测试设定','不把记忆列表显示称为真实千问跨会话使用成功','不含真实用户资料、实物照片、模型视觉或设备操作'],
 modelFollowupPlan:{uiQuestions:['谁送的这幅画？不要补充日期。','纠正赠送者后，这幅画是谁送的？','遗忘后，你还能确认赠送者吗？'],expectedUpstreamRequests:'预计6–9次；依正式执行器最多6次/提问，保守上限18次，主线程串行安排后另测。',status:'not_run'}};
if(!process.argv.includes('--execute-browser')){console.log(JSON.stringify(plan,null,2));process.exit(0);}
if(fs.existsSync(target))throw Error('preserve_existing_browser_evidence');
const previewFile=path.resolve('.runtime/foundation-preview-'+baseURL.port+'.json');
const preview=JSON.parse(fs.readFileSync(previewFile,'utf8'));
assert.equal(preview.syntheticDataOnly,true);assert.equal(preview.url,base);
fs.mkdirSync(ROOT,{recursive:true});
const fd=fs.openSync(target,'wx');
const report={at:new Date().toISOString(),basis:'real_browser_domain_UI_with_synthetic_identity_possession_photos_and_stories_no_model',plan,
 status:'running',pageErrors:[],networkErrors:[],blockedModelRequests:[],checks:[],uiWrites:[],screenshots:[],modelChecks:{status:'not_run',reason:'No model or assistant request is authorized by this zero-model runner.'}};
const ledgerFile=path.resolve(ROOT,'model-calls.json');
const before=JSON.parse(fs.readFileSync(ledgerFile,'utf8')).attempts.length;
const save=()=>{fs.ftruncateSync(fd,0);fs.writeSync(fd,JSON.stringify(report,null,2),0,'utf8');fs.fsyncSync(fd);};
const record=(name,detail={})=>{report.checks.push({name,passed:true,...detail});save();};
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const contexts=[await browser.newContext({viewport:{width:1440,height:1000}}),await browser.newContext({viewport:{width:390,height:844},isMobile:true})];
const pages=await Promise.all(contexts.map(c=>c.newPage()));
const [a,b]=pages;
const syntheticPhoto={name:'synthetic-painting-not-a-real-photo.png',mimeType:'image/png',buffer:await sharp(Buffer.from('<svg width="640" height="480" xmlns="http://www.w3.org/2000/svg"><rect width="640" height="480" fill="#e8dcc4"/><rect x="45" y="45" width="550" height="390" fill="#759f9b"/><text x="95" y="230" font-size="26" fill="white">SYNTHETIC PAINTING</text><text x="95" y="280" font-size="19" fill="white">TEST ONLY - NOT A REAL MEMORY</text></svg>')).png().toBuffer()};

for(const page of pages){
 page.on('pageerror',e=>report.pageErrors.push(e.message));
 page.on('requestfailed',r=>{if(!r.failure()?.errorText?.includes('ERR_ABORTED'))report.networkErrors.push({path:new URL(r.url()).pathname.replace(/\/gift\/[^/]+/,'/gift/[redacted]'),error:r.failure()?.errorText});});
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(!['data:','blob:'].includes(url.protocol)&&url.origin!==base){report.blockedModelRequests.push({kind:'external_browser_network',host:url.hostname});await route.abort('blockedbyclient');return;}
  let action;try{action=request.postDataJSON()?.action;}catch{/* multipart upload is not JSON */}
  const lifeWrite=url.pathname==='/api/life'&&request.method()==='POST';
  const localPhotoUpload=lifeWrite&&/^multipart\/form-data/i.test(request.headers()['content-type']||'');
  const allowedLife=new Set(['createItem','updateItem','fragment','gift','deleteFragment']);
  // GET /api/assistant only refreshes/list sessions; generation is a POST.
  if(url.pathname.startsWith('/api/assistant')&&request.method()!=='GET'||url.pathname.startsWith('/api/ai/')||lifeWrite&&!localPhotoUpload&&!allowedLife.has(action)){
   report.blockedModelRequests.push({kind:'unexpected_or_model_action_blocked',method:request.method(),path:url.pathname,action});save();await route.abort('blockedbyclient');return;
  }
  await route.continue();
 });
 page.on('request',r=>{
  const url=new URL(r.url());if(!['POST','DELETE','PATCH','PUT'].includes(r.method())||url.origin!==base)return;
  let action;try{action=r.postDataJSON()?.action;}catch{}
  // Never store account passwords, cookies, share tokens or complete HTTP bodies.
  report.uiWrites.push({method:r.method(),path:url.pathname.replace(/\/gift\/[^/]+/,'/gift/[redacted]'),action});
 });
}
async function readJSON(page,url){const response=await page.request.get(base+url);assert.ok(response.ok(),'read assertion failed: '+url);return response.json();}
async function capture(page,name){const file=path.resolve(ROOT,stage+'-'+name+'.png');await page.screenshot({path:file,fullPage:false});report.screenshots.push({name,path:path.relative(process.cwd(),file)});save();}
async function register(page,label){
 await page.goto(base);await page.getByLabel('用户名',{exact:true}).fill('Gate3'+label+Date.now().toString().slice(-10));
 await page.getByLabel('口令',{exact:true}).fill(randomBytes(18).toString('hex'));
 await page.getByLabel('第一次使用，创建独立账号',{exact:true}).check();
 await page.getByRole('button',{name:'进入我的物间',exact:true}).click();
 await page.getByRole('button',{name:'生活首页',exact:true}).waitFor();
 const account=(await readJSON(page,'/api/account')).account;assert.match(account.id,/^u_/);return {id:account.id,name:account.name};
}
async function lifeResponse(page,action,click){
 const response=page.waitForResponse(r=>r.url()===base+'/api/life'&&r.request().method()==='POST'&&r.request().postDataJSON()?.action===action);
 await click();const received=await response;const body=await received.json();assert.ok(received.ok(),action+': '+(body.error||received.status()));return body;
}
async function memoryResponse(page,click,method='POST'){
 const response=page.waitForResponse(r=>r.url()===base+'/api/memories'&&r.request().method()===method);
 await click();const received=await response;const body=await received.json();assert.ok(received.ok(),body.error||'memory UI operation failed');return body;
}
async function addStory(page,text,{photo=false,localRecall=false}={}){
 await page.getByRole('button',{name:'帮助',exact:true}).click();
 await page.getByLabel('我和它的故事',{exact:true}).fill(text);
 const local=page.getByLabel('允许在我主动回忆时引用',{exact:true});await local.setChecked(localRecall);
 await page.getByLabel('允许云端模型使用这段故事',{exact:true}).uncheck();
 if(photo){await page.getByLabel('加一张照片',{exact:true}).setInputFiles(syntheticPhoto);await expect(page.getByAltText('待保存的故事照片')).toBeVisible({timeout:20000});}
 const saved=await lifeResponse(page,'fragment',()=>page.getByRole('button',{name:'留下这一段',exact:true}).click());
 assert.equal(saved.fragment.allowCloud,false);assert.equal(saved.fragment.allowRecall,localRecall);return saved.fragment;
}
async function openMemoryCenter(page){const center=page.locator('.memory-center').first();if(await center.getAttribute('open')===null)await center.locator('summary').first().click();await center.getByText('记忆会影响后续相关帮助',{exact:false}).waitFor();return center;}
async function savePrivateRecovery(){
 const prefix=path.resolve('.runtime/foundation-gate3-'+stage);
 await contexts[0].storageState({path:prefix+'-a.json'});await contexts[1].storageState({path:prefix+'-b.json'});
 fs.writeFileSync(prefix+'-items.json',JSON.stringify({base,stage,at:new Date().toISOString(),accounts:report.accounts,item:report.item,gift:report.gift,memoryIds:report.checks.flatMap(c=>c.memoryId?[c.memoryId]:[]),modelFollowup:'not_run; main task must schedule serially'},null,2));
 report.recovery={privateIgnoredBrowserStates:'Saved only under .runtime, never in Git or public evidence',itemId:report.item?.id,receivedItemId:report.gift?.receivedItemId,modelFollowup:'not_run; needs serial scheduling by the main task'};
}

try{
 const owner=await register(a,'甲'),receiver=await register(b,'乙');assert.notEqual(owner.id,receiver.id);report.accounts={ownerId:owner.id,receiverId:receiver.id};
 record('两个真实注册账号和独立浏览器上下文；没有切换演示角色');
 await a.goto(base+'/#add');await a.getByText('录入其他真实商品、说明书或自己的纪念物',{exact:true}).click();
 await a.getByLabel('上传物品照片',{exact:true}).setInputFiles(syntheticPhoto);await expect(a.getByAltText('待录入物品',{exact:true})).toBeVisible({timeout:20000});
 await expect.poll(()=>a.getByAltText('待录入物品',{exact:true}).evaluate(img=>img.complete&&img.naturalWidth>0),{timeout:20000}).toBe(true);
 const name='[合成]朋友送的无型号纪念画 '+stage;
 await a.getByLabel('物品名称',{exact:true}).fill(name);await a.getByLabel('品牌',{exact:true}).fill('');await a.getByLabel('具体型号',{exact:true}).fill('');
 const form=a.locator('form').filter({has:a.getByRole('heading',{name:'确认它的信息',exact:true})});
 await form.locator('input[name="synthetic"]').check();await form.locator('input[name="ownsConfirmed"]').check();await form.locator('input[name="available"]').check();
 await form.getByText('补充能力与维护信息（可稍后填写）',{exact:true}).click();await form.getByLabel('尺寸',{exact:true}).fill('40×30厘米（合成用户报告）');
 const created=await lifeResponse(a,'createItem',()=>a.getByRole('button',{name:'确认并录入物品',exact:true}).click());
 const item=created.item;assert.equal(item.synthetic,true);assert.equal(item.productBinding,undefined);assert.ok(!item.brand);assert.ok(['待确认','未确认',''].includes(item.model));
 await a.waitForURL('**/#item/'+item.id);report.item={id:item.id,name:item.name,model:item.model,synthetic:item.synthetic,photoStored:!!item.photo};
 assert.ok(item.photo);record('UI录入无品牌/型号纪念物、上传合成照片、确认模拟持有；未绑定商品知识');
 const storyText='[合成经历]朋友小夏送了这幅画，没有记录赠送日期。GATE3-OWNER-RELATION';
 const first=await addStory(a,storyText,{photo:true,localRecall:false});
 const memoriesBefore=await readJSON(a,'/api/memories?itemId='+item.id);
 assert.ok(!memoriesBefore.memories.some(m=>m.provenance?.extractor==='item-fragment-consent-v1'&&m.provenance?.sourceId===first.id));
 const confirmed=await memoryResponse(a,()=>a.getByRole('button',{name:'确认保留为这件物品的关系记忆',exact:true}).click());
 const memory=confirmed.memory;assert.ok(memory.id);assert.equal(memory.allowCloud,false);assert.equal(memory.text,storyText);
 await a.reload();await a.getByRole('button',{name:'帮助',exact:true}).click();
 let center=await openMemoryCenter(a);const card=center.locator('article').filter({hasText:'GATE3-OWNER-RELATION'});
 await expect(card).toContainText('小夏');await expect(card).toContainText('仅本地使用');
 record('UI明确确认后，新页面可查看本机关系记忆；没有云端授权或模型请求',{memoryId:memory.id});
 await capture(a,'relationship-desktop');
 await card.getByRole('button',{name:'纠正 / 调整授权',exact:true}).click();
 // An implicit label includes its textarea's current text, so exact accessible
 // label matching is unstable here. The real field's form name is explicit.
 const correction=center.locator('textarea[name="text"]');await expect(correction).toHaveValue(storyText);
 await correction.fill('[合成纠正]这幅画是同事小叶送的，不是小夏；日期仍未知。GATE3-CORRECTED');
 await center.getByLabel('允许在相关提问时把此条记忆提供给已配置的模型',{exact:true}).uncheck();
 await memoryResponse(a,()=>center.getByRole('button',{name:'保存纠正',exact:true}).click());
 const corrected=(await readJSON(a,'/api/memories?itemId='+item.id)).memories.find(m=>m.id===memory.id);
 assert.ok(corrected.text.includes('同事小叶'));assert.equal(corrected.allowCloud,false);assert.ok(corrected.version>memory.version);
 await a.reload();await a.getByRole('button',{name:'帮助',exact:true}).click();center=await openMemoryCenter(a);
 const correctedCard=center.locator('article').filter({hasText:'GATE3-CORRECTED'});await expect(correctedCard).toContainText('同事小叶');
 await memoryResponse(a,()=>correctedCard.getByRole('button',{name:'忘记',exact:true}).click(),'DELETE');
 assert.ok(!(await readJSON(a,'/api/memories?itemId='+item.id)).memories.some(m=>m.id===memory.id));
 record('UI纠正和遗忘确实写入原记忆版本；不是只改前端显示',{newVersion:corrected.version});
 const privateText='[合成私人]PRIVATE-NOT-FOR-GIFT：这页只属于赠送者。';
 await addStory(a,privateText);
 const selectedText='[合成可分享]这幅画曾陪我搬家，现在愿把这一页传给你。';
 const selected=await addStory(a,selectedText);
 const denied=await b.request.get(base+'/api/life?itemId='+item.id);assert.equal(denied.status(),403);
 const mediaURL=new URL(item.photo,base);assert.match(mediaURL.pathname,/^\/api\/life\/media\/[a-z0-9-]+$/i);
 const ownMedia=await a.request.get(base+mediaURL.pathname);assert.equal(ownMedia.status(),200,'media must exist for its owner before testing denial');
 const deniedMedia=await b.request.get(base+mediaURL.pathname);
 report.mediaIsolationCheck={status:deniedMedia.status(),method:'unauthorized read assertion; media id from registered photo URL'};
 assert.ok([403,404].includes(deniedMedia.status()));
 const spoof=await b.request.get(base+'/api/life',{headers:{'x-demo-actor':owner.id}});const spoofed=await spoof.json();assert.ok(!spoofed.workspace.items.some(i=>i.id===item.id));
 record('独立账号在分享前不能读原物品/照片，也不能用演示身份头冒充物主');
 await a.getByRole('button',{name:'资料与管理',exact:true}).click();
 const giftForm=a.locator('form').filter({has:a.getByLabel(/^给收礼人的话/)});
 await giftForm.getByLabel(/^给收礼人的话/).fill('[合成赠礼]愿它陪你开启新的一页；未选私事不传递。');
 await giftForm.getByLabel(selectedText,{exact:true}).check();
 await expect(giftForm.getByLabel(privateText,{exact:true})).not.toBeChecked();
 await giftForm.getByRole('button',{name:'预览礼物与所选故事',exact:true}).click();
 await a.getByText('只携带 1 条选中文字快照',{exact:false}).waitFor();
 const giftResponse=await lifeResponse(a,'gift',()=>a.getByRole('button',{name:'确认制作礼物',exact:true}).click());
 const gift=giftResponse.gift;assert.ok(gift.token);report.gift={id:gift.id,selectedStoryId:selected.id,shareToken:'[not published]'};
 await b.goto(base+'/gift/'+gift.token);await b.getByRole('heading',{name:'有一份心意，想交到你手里。',exact:true}).waitFor();
 await expect(b.locator('body')).toContainText(selectedText);await expect(b.locator('body')).not.toContainText('PRIVATE-NOT-FOR-GIFT');
 await expect(b.locator('body')).not.toContainText('GATE3-OWNER-RELATION');
 await capture(b,'gift-preview-mobile');
 await b.getByLabel('我确认已实际取得这件物品',{exact:true}).check();
 // This checkbox represents simulated receipt in this synthetic account; it is
 // not evidence of an actual painting moving between physical people.
 const claimResponse=b.waitForResponse(r=>r.url()===base+'/api/workspace'&&r.request().method()==='POST'&&r.request().postDataJSON()?.action==='claim');
 await b.getByRole('button',{name:'认领并延续记忆',exact:true}).click();assert.ok((await claimResponse).ok());await b.getByText('礼物已认领。',{exact:false}).waitFor();
 const receivedWorkspace=await readJSON(b,'/api/workspace'),received=receivedWorkspace.items.find(i=>i.transferredFrom?.giftId===gift.id);
 assert.ok(received&&received.id!==item.id&&received.owner===receiver.id);report.gift.receivedItemId=received.id;
 assert.ok(!JSON.stringify(receivedWorkspace).includes('PRIVATE-NOT-FOR-GIFT'));
 await b.goto(base+'/#item/'+received.id);await b.getByRole('button',{name:'帮助',exact:true}).waitFor();
 await addStory(b,'[合成收礼人私事]RECEIVER-ONLY-HISTORY，不回流给原主。');
 const giverLife=await readJSON(a,'/api/life');assert.ok(!JSON.stringify(giverLife).includes('RECEIVER-ONLY-HISTORY'));
 const receiverLife=await readJSON(b,'/api/life');assert.ok(!JSON.stringify(receiverLife).includes('PRIVATE-NOT-FOR-GIFT'));
 record('UI选择性赠礼、独立账号预览/模拟认领、独立物品实例及后续双向私人故事隔离');
 await capture(b,'recipient-story-mobile');
 await savePrivateRecovery();
 assert.equal(report.blockedModelRequests.length,0,'unexpected AI/external request attempted; do not claim a clean zero-model journey');
 assert.equal(report.pageErrors.length,0);
 report.status='domain_ui_journeys_passed_model_recall_not_run';
}catch(error){report.status='failed';report.failure={name:error.name,message:error.message.replace(/\/gift\/[^\s/]+/g,'/gift/[redacted]')};process.exitCode=1;await capture(a,'failure-desktop').catch(()=>{});await capture(b,'failure-mobile').catch(()=>{});}
finally{await savePrivateRecovery().catch(error=>{report.recoveryError=error.message;});report.finishedAt=new Date().toISOString();report.ledgerWindowDelta=JSON.parse(fs.readFileSync(ledgerFile,'utf8')).attempts.length-before;report.ledgerWindowCaveat='Global ledger window; any concurrent unrelated call must be investigated, not attributed to this runner.';save();fs.closeSync(fd);await browser.close();console.log(JSON.stringify({status:report.status,target,checks:report.checks,blockedModelRequests:report.blockedModelRequests,ledgerWindowDelta:report.ledgerWindowDelta,modelChecks:report.modelChecks,failure:report.failure},null,2));}
