import {writeFileSync} from 'node:fs';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:3147';
const headers={'x-demo-actor':'lin','Content-Type':'application/json'};
async function post(path,body){const r=await fetch(base+path,{method:'POST',headers,body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
const created=await post('/api/workspace',{action:'createItem',name:'Review synthetic M185'});
const id=created.body.items.at(-1).id;
await post('/api/workspace',{action:'bindProduct',itemId:id,packId:'logitech-m185-m-r0061',confirmed:true});
const input={itemId:id,question:'电池规格是什么？',mode:'service'};
const result=await post('/api/ai',input);
if(result.status!==503||result.body.run.errorCode!=='not_configured')throw Error('Expected missing config');
const replay=await (await fetch(base+`/api/service-runs?runId=${result.body.run.id}&replay=1`,{headers})).json();
writeFileSync('review-evidence/agent-unconfigured-example.json',JSON.stringify({kind:'synthetic-input-real-local-api-no-model',input,result,replay},null,2));
