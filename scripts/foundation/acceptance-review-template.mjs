// Independent source-based review template. Never asks Qwen to grade itself.
import fs from 'node:fs';import {createHash} from 'node:crypto';
const root='docs/engineering/qwen-foundation-2026-11-02/acceptance';
const manifest=JSON.parse(fs.readFileSync(root+'/FREEZE_SHA256.json','utf8'));
for(const [name,sha]of Object.entries(manifest.frozenFiles))if(createHash('sha256').update(fs.readFileSync(root+'/'+name)).digest('hex')!==sha)throw Error('frozen_changed');
const key=JSON.parse(fs.readFileSync(root+'/answers.frozen.json','utf8'));
const journeys=JSON.parse(fs.readFileSync(root+'/journeys.frozen.json','utf8'));
const output=process.argv.find(x=>x.startsWith('--output='))?.slice(9);
if(!output||!/^docs\/engineering\/qwen-foundation-2026-11-02\/evidence\/acceptance-runs\/[a-z0-9-]+\/REVIEW_TEMPLATE\.json$/.test(output))throw Error('explicit_new_run_review_path_required');
const template={frozenHashes:manifest.frozenFiles,reviewer:{name:'',role:'independent_source_review_not_external_blind_human_test',reviewedAt:null},gates:{firstAnswerMinimum:15,totalQuestions:18,severeErrorsAllowed:0,browserJourneysRequired:4},cases:key.answers.map(a=>({caseId:a.id,source:key.sources[a.sourceId],arms:['product','direct'].map(arm=>({arm,firstResultSha256:null,firstResultFile:null,required:a.required.map(criterion=>({criterion,verdict:'not_scored',actualAnswerSpan:'',sourceLocator:''})),criticalFailures:a.criticalFailures.map(criterion=>({criterion,occurred:null,actualAnswerSpan:''})),modelApplicability:'not_scored',retrievalFailure:null,modelReasoningFailure:null,fullTaskPass:null,reviewNotes:''}))})),journeys:journeys.journeys.map(j=>({id:j.id,status:'not_run',realBrowser:false,evidence:[],stepChecks:j.steps.map(step=>({step,passed:null})),propertyChecks:j.checks.map(property=>({property,passed:null})),notes:''})),permissionNegatives:journeys.negatives.map(n=>({...n,status:'not_run',evidence:[]})),overall:'not_scored_not_accepted'};
fs.writeFileSync(output,JSON.stringify(template,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({created:output,questions:key.answers.length,productAcceptance:'not_scored',modelCalls:0}));
