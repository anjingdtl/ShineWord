'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {createPhase6MobileHarness} = require('./helpers/phase6MobileHarness.cjs');
const {sha} = require('./helpers/mobileHarness.cjs');
const {OpeningSurveyService} = require('../dist/application/segmentBuild/openingSurvey');
const {applyExtraction} = require('../dist/application/world/extraction');
const profile={id:'test',name:'test',endpoint:'https://example.invalid',model:'test',keyRef:'k',reasoningTier:'low',
 capabilities:{supportsJson:true,reportsUsage:true,supportsStreaming:false,contextWindow:60000,maxOutputTokens:12000}};
async function fixture(provider){
 const text='第一章 到达\n林辰😀走入旧桥镇。旧桥镇位于南河岸。黎明，林辰向桥卫询问道路。'+ '河水静静流淌。'.repeat(1000);
 const h=await createPhase6MobileHarness({bytes:Buffer.from(text)});
 const imported=await h.sourceImport.importNovelForOpeningStreaming('memory','synthetic.txt',profile,()=>{});
 const service=new OpeningSurveyService({catalog:h.runtime.sourceCatalog,store:h.runtime.openingSurveys,provider,profile,
  governance:{profile,runId:imported.runIds[0],worldId:imported.worldId,modelProfileFingerprint:'test'},sha256Hex:sha.sha256Hex});
 const input={worldId:imported.worldId,sourceId:imported.sourceId,configFingerprint:(await h.runtime.segmentPlans.getPlan(imported.worldId)).executionConfigFingerprint,
  assertCurrent:async tx=>{if(!await tx.queryOne('SELECT world_id FROM worlds WHERE world_id=?',[imported.worldId]))throw Error('deleted')}};
 return {h,imported,service,input,text};
}
const evidence=[{category:'character',label:'林辰',window:0,quote:'林辰😀走入旧桥镇。'},
 {category:'location',label:'旧桥镇',window:0,quote:'旧桥镇位于南河岸。'},
 {category:'event',label:'问路',window:0,quote:'黎明，林辰向桥卫询问道路。'},
 {category:'timeline',label:'黎明',window:0,quote:'黎明，林辰向桥卫询问道路。'},
 {category:'relationship',label:'林辰与桥卫',window:0,quote:'黎明，林辰向桥卫询问道路。'}];
test('10% survey is a governed P1 planning request; verified code-point evidence is cached without writing facts',async()=>{
 let calls=0;const f=await fixture({async complete(req){calls++;assert.equal(req.requestKind,'registry');assert.equal(req.maxPhysicalRequests,1);
 assert.ok(req.ledger.logicalRequestId.startsWith('opening-survey:'));return {text:JSON.stringify({evidence})}}});
 try{const first=await f.service.prepare(f.input);assert.ok(first.estimatedInputTokens<=6000);assert.equal(first.inputTokenLimit,6000);
 assert.equal(first.recommendedEndCp,3200);assert.equal(first.evidence.length,5);
 assert.equal(first.evidence[0].range.startCp,Array.from(f.text.slice(0,f.text.indexOf(evidence[0].quote))).length);
 assert.equal(await f.h.runtime.sourceCatalog.readRange(first.evidence[0].range),evidence[0].quote);
 assert.deepEqual(await f.service.prepare(f.input),first);assert.equal(calls,1);
 assert.equal((await f.h.runtime.worldStore.listFacts(f.imported.worldId)).length,0);
 }finally{f.h.db.close()}
});
test('unsupported quote and empty front matter diagnose a single known failure; never fabricate planning evidence',async()=>{
 let calls=0;const f=await fixture({async complete(){calls++;return {text:JSON.stringify({evidence:[...evidence.slice(0,2),{...evidence[2],quote:'并不存在的句子。'}]})}}});
 try{assert.equal(await f.service.prepare(f.input),null);assert.equal(await f.service.prepare(f.input),null);assert.equal(calls,1);
 assert.equal((await f.h.adapter.queryOne('SELECT status FROM world_opening_surveys')).status,'failed');
 }finally{f.h.db.close()}
});
test('interrupted survey and deletion fence cannot automatically repeat a paid request or resurrect data',async()=>{
 let calls=0;const f=await fixture({async complete(){calls++;await f.h.adapter.execute('DELETE FROM worlds WHERE world_id=?',[f.imported.worldId]);return {text:JSON.stringify({evidence})}}});
 try{await assert.rejects(f.service.prepare(f.input),/deleted/);assert.equal(calls,1);
 assert.equal((await f.h.adapter.queryOne('SELECT COUNT(*) n FROM world_opening_surveys')).n,0);
 }finally{f.h.db.close()}
 const g=await fixture({async complete(){return {text:JSON.stringify({evidence})}}});
 try{const first=await g.service.prepare(g.input);await g.h.adapter.execute("UPDATE world_opening_surveys SET status='running',result_json=NULL");
 await assert.rejects(g.service.prepare(g.input),/outcome_unknown/);
 }finally{g.h.db.close()}
});
test('location predicate cannot use arbitrary prose as a place; evidenced canonical place stays available',async()=>{
 const text='侍女提醒林辰桥卫想见他。林辰走入旧桥镇。';const source={chapters:[{chapterId:'ch-1',startOffset:0,endOffset:Array.from(text).length}],sliceRange:async(a,b)=>Array.from(text).slice(a,b).join('')};
 const quote='侍女提醒林辰桥卫想见他。';const good='林辰走入旧桥镇。';const extraction={entities:[{entityKey:'lin',type:'character',name:'林辰'},{entityKey:'town',type:'location',name:'旧桥镇'}],events:[],facts:[
 {subjectKey:'lin',predicate:'current_location',value:{text:quote},status:'explicit',confidence:1,evidence:{chapterId:'ch-1',startOffset:0,endOffset:Array.from(quote).length,quote}},
 {subjectKey:'lin',predicate:'current_location',value:{location:'旧桥镇'},status:'explicit',confidence:1,evidence:{chapterId:'ch-1',startOffset:Array.from(quote).length,endOffset:Array.from(text).length,quote:good}}]};
 const result=await applyExtraction({worldId:'w',source,extraction,createdAt:new Date().toISOString(),sha256Hex:sha.sha256Hex,strictLocationClaims:true});
 assert.equal(result.facts.length,1);assert.equal(result.facts[0].value.location,'旧桥镇');assert.equal(result.rejected.length,1);assert.match(result.rejected[0].detail,/location value/);
});
