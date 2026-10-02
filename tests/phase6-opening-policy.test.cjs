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
