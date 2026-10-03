const test=require('node:test'),assert=require('node:assert/strict');
const {openingInputCodePoints}=require('../dist/application/worldBuild/openingPolicy');
const {freezeRunConfig,reviveRunConfig,frozenConfigIdentity}=require('../dist/application/worldBuild/runConfig');
const profile={id:'test',name:'test',endpoint:'https://example.invalid/v1',model:'test',keyRef:'test',capabilities:{contextWindow:60000,maxOutputTokens:12000,supportsJson:true}};
const budget={contextWindowTokens:60000,maxContentOutputTokens:6000,reasoningReserveTokens:0,reserveTokens:2000,reasoningEffort:'low',supportsPromptCache:false};
test('opening scope respects 10% and total input/output budget; huge windows stay bounded',()=>{
 assert.equal(openingInputCodePoints(budget),6000);
 assert.equal(openingInputCodePoints({...budget,contextWindowTokens:1000000}),6400);
 assert.throws(()=>openingInputCodePoints({...budget,contextWindowTokens:9000}),/insufficient/);
});
test('opening strategy freezes and survives restart; legacy fingerprint is unchanged until opted in',()=>{
 const old=freezeRunConfig(profile,budget), fresh=freezeRunConfig(profile,budget,{openingPolicyVersion:'opening-90s-1',bodyTargetRatio:0.10});
 assert.equal(old.openingPolicyVersion,undefined);assert.equal(reviveRunConfig(JSON.stringify(fresh)).openingPolicyVersion,'opening-90s-1');
 assert.notEqual(frozenConfigIdentity(old),frozenConfigIdentity(fresh));
});

test('async scoped storage chunks retain chapter identity and exact evidence hashes at both edges',async()=>{
 const crypto=require('node:crypto');const {createExtractionRun}=require('../dist/application/worldBuild/coordinator');
 const sha=t=>crypto.createHash('sha256').update(t).digest('hex');const text='章人物地点事件'.repeat(100);
 const chapters=[{chapterId:'a',index:0,title:'第一章',startOffset:0,endOffset:300,charCount:300,contentHash:sha(text.slice(0,300))},
  {chapterId:'b',index:1,title:'第二章',startOffset:300,endOffset:600,charCount:300,contentHash:sha(text.slice(300,600))}];
 // SourceStore's typed records may use accessors; enumerability is not part of
 // the port contract. Async hashing must not lose identity on a narrowed edge.
 const chunks=[['a1','a',0,0,300],['b1','b',0,300,450],['b2','b',1,450,600]].map(([chunkId,chapterId,chunkIndex,startOffset,endOffset])=>{
  const values={chunkId,chapterId,chunkIndex,startOffset,endOffset,charCount:endOffset-startOffset,contentHash:sha(text.slice(startOffset,endOffset))};
  return Object.defineProperties({},Object.fromEntries(Object.entries(values).map(([k,v])=>[k,{get:()=>v}])));
 });
 const reads=[];let saved;
 await createExtractionRun({sourceStore:{async getManifest(){return{status:'active',normalizedTreeHash:sha('source')};},
  async getChunks(){return chunks;},async getChapters(){return chapters;},async readRange(sourceId,start,end){
   assert.equal(sourceId,'source');reads.push([start,end]);await new Promise(resolve=>setImmediate(resolve));return text.slice(start,end);}},
  sha256Hex:async t=>{await new Promise(resolve=>setImmediate(resolve));return sha(t);},
  runStore:{async createRun(run,units){saved={run,units};}},worldStore:{async getWorld(){return{};},async listWorldSources(){return[{sourceId:'source',sourceOrdinal:1}];}}},
  {runId:'scoped',worldId:'world',sourceId:'source',title:'范围夹具',modelFingerprint:'fixture',extractorVersion:'fixture',mode:'group',scope:{startCp:99,endCp:455},budget});
 const ranges=saved.units.flatMap(u=>JSON.parse(u.sourceRangesJson).ranges);
 assert.deepEqual(ranges.map(r=>[r.chunkId,r.chapterId,r.startCp,r.endCp]),[['a1','a',99,300],['b1','b',300,450],['b2','b',450,455]]);
 assert.deepEqual(reads,[[99,300],[450,455]]);
 const {planAnalysisBatches}=require('../dist/application/worldBuild/analysisBatchPlanner');
 const clipped=chunks.map(c=>({chunkId:c.chunkId,chapterId:c.chapterId,chunkIndex:c.chunkIndex,startOffset:Math.max(99,c.startOffset),endOffset:Math.min(455,c.endOffset),charCount:Math.min(455,c.endOffset)-Math.max(99,c.startOffset),contentHash:sha(text.slice(Math.max(99,c.startOffset),Math.min(455,c.endOffset)))}));
 const expected=planAnalysisBatches(chapters,clipped,budget)[0];
 assert.equal(saved.units[0].inputHash,sha(`${expected.inputHashSeed}|all`));
});

test('model scalar and nested location values adapt without inventing a place from source prose',async()=>{
 const {normalizeFactValue}=require('../dist/application/world/factValueAdapter');
 assert.deepEqual(normalizeFactValue('current_location','旧桥','林辰来到旧桥'),{location:'旧桥'});
 assert.deepEqual(normalizeFactValue('current_location',{current_location:{location:'旧桥'}},'林辰来到旧桥'),{location:'旧桥'});
 assert.deepEqual(normalizeFactValue('current_location',{},'侍女提醒罗兰'),{text:'侍女提醒罗兰'});
 const {LlmGroupExtractor}=require('../dist/application/world/llmGroupExtractor');
 const extractor=new LlmGroupExtractor(async()=>({text:JSON.stringify({entities:[{key:'hero',type:'character',name:'林辰'},{key:'place',type:'location',name:'旧桥'}],facts:[{subject:'hero',predicate:'current_location',value:'旧桥',status:'explicit',confidence:1,segment:1,quote:'林辰来到旧桥'}],events:[],ruleMappings:[]})}));
 const result=await extractor.extract({worldId:'w',unitId:'u',segments:[{chunkId:'c',chapterId:'ch',chapterTitle:'第一章',startCp:0,text:'林辰来到旧桥'}]});
 assert.deepEqual(result.facts[0].value,{location:'旧桥'});assert.equal(result.facts[0].evidence.startOffset,0);
});
