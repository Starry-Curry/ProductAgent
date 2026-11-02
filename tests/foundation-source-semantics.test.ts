import test from 'node:test';
import assert from 'node:assert/strict';
import type {Provider} from '../src/lib/ai/provider.ts';
import {extractSourceSemantics,sourceSemanticsCacheKey,modelSourceSemantics,type ScopedSemanticSource,type SourceSemanticsResult} from '../src/lib/context/source-semantics.ts';

// Synthetic source fixtures and provider substitutes only; no frozen questions,
// official retrieval claims, HTTP requests or real upstream model calls.
const source:ScopedSemanticSource={id:'source-generic-42',itemId:'instance-42',model:'UNSEEN-42',region:'us',
 text:'UNSEEN-42\nBefore use, disconnect the power.\nHold the button for 5 seconds.\nDo not immerse in water.\n[figure unread]',
 url:'https://manufacturer.example/manual/UNSEEN-42',hash:'synthetic-document-hash-42',
 reading:{mode:'pdf_text_layer',limitations:['按钮图示未读取'],figures:[]}};
const subject={itemId:source.itemId,model:source.model,region:source.region};
const fact=(extra:Record<string,unknown>={})=>({kind:'operation',subject,sourceId:source.id,exactQuote:'Hold the button for 5 seconds.',conditions:['Before use, disconnect the power.'],unknown:null,...extra});
function stub(payload:unknown,check?:(input:any,options:any)=>void):{provider:Provider;calls:()=>number}{
 let calls=0;
 return {calls:()=>calls,provider:{ready:true,model:'offline-schema-model-v1',generate:async(_system,input,options)=>{calls++;check?.(input,options);const selected=structuredClone(payload) as any; for(const row of selected?.observations||[]){ if(!Object.hasOwn(row,'exactQuote'))continue;const quote=row.exactQuote,scope=(input as any).sources.find((s:any)=>s.id===row.sourceId)||(input as any).sources[0];row.quoteSpans=quote===null?[]:scope.spans.filter((p:any)=>p.text.includes(quote)||quote.includes(p.text)).map((p:any)=>p.id);if(quote&&row.quoteSpans.length===0)row.quoteSpans=['missing-span'];delete row.exactQuote;} return {text:JSON.stringify(selected),model:'offline-schema-model-v1',tokens:{input:31,output:17},usage:{fixtureOnly:true}};}}};
}

test('source semantics invokes one JSONSchema extraction and retains quote, source scope, conditions and unread-figure limits',async()=>{
 const f=stub({observations:[fact()]},(input,options)=>{
  assert.equal(options.json,true);assert.equal(options.jsonSchema.name,'wujian_source_semantics');
  const properties=options.jsonSchema.schema.properties.observations.items.properties;
  assert.deepEqual(properties.sourceId.enum,[source.id]);assert.ok(!Object.hasOwn(properties,'supported'));
  assert.equal(input.sources[0].spans.map((p:any)=>p.text).join('\n'),source.text);assert.deepEqual(input.sources[0].subject,subject);
 });
 const before=structuredClone(source),r=await extractSourceSemantics(f.provider,'如何操作？',[source]);
 assert.equal(f.calls(),1);assert.equal(r.modelCalls,1);assert.equal(r.status,'candidate_quote_checked');
 const o=r.observations[0];assert.equal(o.exactQuote,'Hold the button for 5 seconds.');
 assert.equal(o.source.url,source.url);assert.equal(o.source.hash,source.hash);assert.deepEqual(o.subject,subject);
 assert.deepEqual(o.conditions,['Before use, disconnect the power.']);assert.equal(o.conditionsStatus,'extracted_candidates_not_independently_verified');
 assert.equal(o.quoteRange!.start,source.text.indexOf(o.exactQuote!));
 assert.ok(o.reading.limitations.some(s=>s.includes('按钮图示未读取')));assert.ok(o.reading.limitations.some(s=>s.includes('仅取得PDF文字层')));
 assert.equal(o.verification,'scope_and_exact_quote_only_not_semantic_proof_or_instance_verification');
 assert.deepEqual(r.tokens,{input:31,output:17});assert.deepEqual(r.usage,{fixtureOnly:true});assert.deepEqual(source,before);
});

test('bad source, item, model, region and noncontinuous quotes are locally rejected without swallowing the valid observation',async()=>{
 const f=stub({observations:[fact(),fact({sourceId:'foreign-private-source'}),fact({subject:{...subject,itemId:'foreign-item'}}),
  fact({subject:{...subject,model:'UNSEEN-420'}}),fact({subject:{...subject,region:'jp'}}),fact({exactQuote:'Hold the button. 5 seconds.'})]});
 const r=await extractSourceSemantics(f.provider,'操作和条件',[source]);
 assert.equal(f.calls(),1);assert.equal(r.status,'partial');assert.equal(r.observations.length,1);assert.equal(r.rejected.length,5);
 assert.ok(r.rejected.some(e=>e.reasons.includes('source_not_in_current_scope')));
 assert.equal(r.rejected.filter(e=>e.reasons.includes('subject_model_or_region_scope_mismatch')).length,3);
 assert.ok(r.rejected.some(e=>e.reasons.includes('source_span_not_found')));
});

test('absence remains insufficient evidence; explicit negative source text survives, unquoted negative claims do not',async()=>{
 const unknown=fact({kind:'unknown',exactQuote:null,unknown:'本次选定资料未提供保修期限。',conditions:[]});
 const f=stub({observations:[unknown,fact({kind:'fact',exactQuote:'Do not immerse in water.',conditions:[]}),
  fact({kind:'unknown',exactQuote:null,unknown:'该产品不支持保修。',conditions:[]})]});
 const r=await extractSourceSemantics(f.provider,'使用限制和保修期限？',[source]);
 assert.equal(r.status,'partial');assert.equal(r.observations.length,2);
 assert.equal(r.observations[0].status,'insufficient_evidence');assert.equal(r.observations[0].quoteRange,null);
 assert.equal(r.observations[1].exactQuote,'Do not immerse in water.');
 assert.ok(r.rejected[0].reasons.includes('unquoted_unknown_must_not_assert_negative_fact'));
});

test('self-declared supported/visual proof and wrong unknown types are schema failures, never fact certification',async()=>{
 const f=stub({observations:[fact({supported:true}),fact({visualVerified:true}),fact({kind:'unknown',exactQuote:null,unknown:['资料不足']})]});
 const r=await extractSourceSemantics(f.provider,'按钮是什么样？',[source]);
 assert.equal(f.calls(),1);assert.equal(r.status,'invalid_output');assert.equal(r.observations.length,0);assert.equal(r.rejected.length,3);
 assert.ok(r.rejected.every(e=>e.reasons[0].startsWith('observation_schema_invalid')));
 assert.ok(r.sourceWarnings[0].reading.limitations.includes('按钮图示未读取'));
});

test('cache is opt-in, charges zero generate calls on hit, and keys change with question/scope/source/model/reading',async()=>{
 const f=stub({observations:[fact()]}),cache=new Map<string,SourceSemanticsResult>();
 const first=await extractSourceSemantics(f.provider,'如何操作？',[source],{cache});
 const second=await extractSourceSemantics(f.provider,'如何操作？',[source],{cache});
 assert.equal(f.calls(),1);assert.equal(first.cacheHit,false);assert.equal(second.cacheHit,true);
 assert.equal(second.modelCalls,0);assert.equal(second.tokens,null);assert.equal(second.usage,null);
 const key=sourceSemanticsCacheKey('如何操作？',[source],f.provider.model);
 for(const changed of [{...source,hash:'new-hash'},{...source,text:source.text+'\nNew notice.'},{...source,region:'jp'},
  {...source,model:'UNSEEN-43'},{...source,itemId:'different-instance'},{...source,reading:{mode:'unknown' as const,limitations:[],figures:[]}}])
  assert.notEqual(sourceSemanticsCacheKey('如何操作？',[changed],f.provider.model),key);
 assert.notEqual(sourceSemanticsCacheKey('能清洗吗？',[source],f.provider.model),key);
 assert.notEqual(sourceSemanticsCacheKey('如何操作？',[source],'model-v2'),key);
 second.observations[0].conditions.push('caller mutation must not contaminate cache');
 assert.equal((await extractSourceSemantics(f.provider,'如何操作？',[source],{cache})).observations[0].conditions.length,1);
});

test('empty or ambiguous inputs do not trigger a provider; provider/JSON failures invoke no repair loop',async()=>{
 const f=stub({observations:[]});
 const empty=await extractSourceSemantics(f.provider,'如何用？',[]);assert.equal(empty.modelCalls,0);assert.equal(empty.status,'no_sources');
 await assert.rejects(()=>extractSourceSemantics(f.provider,'如何用？',[source,{...source,model:'OTHER'}]),/ambiguous/);
 assert.equal(f.calls(),0);
 let failures=0;const p:Provider={ready:true,model:'offline-failing',generate:async()=>{failures++;throw Error('synthetic_timeout');}};
 const error=await extractSourceSemantics(p,'如何用？',[source]);assert.equal(failures,1);assert.equal(error.status,'provider_error');assert.equal(error.modelCalls,1);
 let invalidCalls=0;const invalid:Provider={ready:true,model:'offline-invalid',generate:async()=>{invalidCalls++;return {text:'bad JSON',model:'offline-invalid',tokens:{input:3,output:2}};}};
 const malformed=await extractSourceSemantics(invalid,'如何用？',[source]);assert.equal(invalidCalls,1);assert.equal(malformed.status,'invalid_output');assert.deepEqual(malformed.tokens,{input:3,output:2});
});

test('compact source semantics retains every observation, original range and scoped provenance; only repeated metadata is deduplicated',async t=>{
 const s:ScopedSemanticSource={...source,text:Array.from({length:8},(_,n)=>'Recorded operation '+(n+1)+': set the labelled control to position '+(n+1)+'.').join('\n'),
  reading:{mode:'pdf_text_layer',limitations:['方向图示未读取；不得推断旋转方向。'],figures:[{url:'https://manufacturer.example/figure-42.png',caption:'图示未读取'}]}};
 const rows=s.text.split('\n').map((quote,n)=>fact({kind:n===0?'condition':'operation',exactQuote:quote,conditions:['先核对供电状态；此条件是候选而非实物验证。']}));
 const f=stub({observations:rows}),r=await extractSourceSemantics(f.provider,'依次需要做什么？',[s]);
 const before=structuredClone(r),compact=modelSourceSemantics(r);
 assert.equal(compact.observations.length,r.observations.length);
 assert.equal(Object.keys(compact.sources).length,1);
 for(const original of r.observations){
  const o=compact.observations.find(o=>o.id===original.id)!;assert.ok(o);
  assert.equal(o.kind,original.kind);assert.equal(o.status,original.status);assert.equal(o.sourceId,original.sourceId);
  assert.equal(o.exactQuote,original.exactQuote);assert.deepEqual(o.quoteRange,original.quoteRange);
  assert.deepEqual(o.conditions,original.conditions);assert.equal(o.unknown,original.unknown);
  const provenance=compact.sources[o.sourceId];
  assert.equal(provenance.itemId,original.subject.itemId);assert.equal(provenance.model,original.subject.model);assert.equal(provenance.region,original.subject.region);
  assert.equal(provenance.url,original.source.url);assert.equal(provenance.hash,original.source.hash);
  for(const limit of original.reading.limitations)assert.ok(provenance.reading.limitations.includes(limit));
  assert.equal(provenance.reading.mode,original.reading.mode);
  for(const figure of original.reading.figures)assert.ok(provenance.reading.figures.some(f=>f.url===figure.url&&f.caption===figure.caption));
  assert.equal(s.text.slice(o.quoteRange!.start,o.quoteRange!.end),o.exactQuote);
 }
 assert.equal(compact.verification,'scope_and_exact_quote_only_not_semantic_proof_or_instance_verification');
 assert.equal(compact.conditionsStatus,'extracted_candidates_not_independently_verified');
 assert.equal(Object.hasOwn(compact,'rawOutput'),false);assert.equal(Object.hasOwn(compact,'usage'),false);
 assert.deepEqual(r,before,'transport construction cannot rewrite original extraction evidence');
 const legacySemanticFields={status:r.status,observations:r.observations,warnings:r.sourceWarnings,rejected:r.rejected};
 const legacyBytes=Buffer.byteLength(JSON.stringify(legacySemanticFields),'utf8'),compactBytes=Buffer.byteLength(JSON.stringify(compact),'utf8');
 assert.ok(compactBytes<legacyBytes,'the eight-observation synthetic fixture should remove repeated metadata');
 t.diagnostic(JSON.stringify({basis:'offline_utf8_bytes_synthetic_eight_observations_one_source_not_tokens_or_quality',legacySemanticBytes:legacyBytes,compactSemanticBytes:compactBytes,savedBytes:legacyBytes-compactBytes,excludedFromBothComparison:'rawOutput, usage, cacheKey and cost metadata'}));
 compact.observations[0].conditions.push('caller mutation');compact.sources[s.id].reading.limitations.push('caller mutation');
 assert.deepEqual(r,before);
});

test('compact view keeps unknown/rejected/orphan visual warnings and does not invent missing source metadata',async()=>{
 const orphan:ScopedSemanticSource={...source,id:'unselected-figure-source',hash:'orphan-hash',reading:{mode:'unknown',limitations:['未读图示ORPHAN-WARNING'],figures:[]}};
 const f=stub({observations:[fact({kind:'unknown',exactQuote:null,unknown:'本次资料未提供保修期限。',conditions:[]}),fact({sourceId:'bad-reference'})]});
 const r=await extractSourceSemantics(f.provider,'保修和按钮？',[source,orphan]),before=structuredClone(r),compact=modelSourceSemantics(r);
 assert.equal(compact.observations.length,1);assert.equal(compact.observations[0].status,'insufficient_evidence');
 assert.equal(compact.observations[0].exactQuote,null);assert.equal(compact.observations[0].quoteRange,null);
 assert.equal(compact.observations[0].unknown,'本次资料未提供保修期限。');
 assert.equal(compact.sources[source.id].model,source.model);assert.equal(compact.sources[source.id].url,source.url);
 assert.deepEqual(compact.rejected,r.rejected);
 assert.ok(compact.unmatchedSourceWarnings.some(w=>w.sourceId===orphan.id&&w.reading.limitations.includes('未读图示ORPHAN-WARNING')));
 assert.equal(Object.hasOwn(compact.sources,orphan.id),false,'no accepted observation means the result supplies no subject metadata to fabricate');
 assert.deepEqual(r,before);
});
