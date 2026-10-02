'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {segmentKnowledgeFromConfirmedEvidence:select}=require('../dist/application/campaign/segmentKnowledge');
const fact=(id,start,end,patch={})=>({worldId:'w',factId:id,subjectEntityId:'hero',status:'explicit',scope:'world',validFrom:null,validTo:null,revealAt:null,sources:[{chapterId:'ch-1',startOffset:start,endOffset:end}],...patch});
const entry=(id,facts,dependencies=[],patch={})=>({entryId:id,kind:'lore',revision:1,visibility:'discoverable',revealPolicyId:'segment-explicit-discovery',provenance:{kind:'explicit',sourceFactIds:facts},fieldProvenance:{},dependencyIds:dependencies,...patch});
test('reading evidence unlocks only adopted closed dependencies; future, GM, partial and unclassified content stay private',()=>{
 const entries=[entry('person',['person']),entry('scene',['place'],['person']),entry('future',['future']),entry('gm',['person'],[],{visibility:'gm'}),entry('partial',['partial']),entry('broken',['person'],['missing']),entry('other-policy',['person'],[],{revealPolicyId:'some-other'}),entry('no-proof',[])];
 const facts=[fact('person',10,20),fact('place',25,30),fact('future',30,35,{revealAt:'10'}),fact('partial',30,41)];
 const input={entries,facts,worldTimeOrder:5,knownEntryIds:new Set(),knownRanges:[{chapterId:'ch-1',startCodePoint:10,endCodePoint:40}]};
 assert.deepEqual(select(input),['person','scene']);assert.deepEqual(select({...input,knownRanges:[]}),[]);
 assert.deepEqual(select({...input,knownRanges:[{chapterId:'s2-ch-1',startCodePoint:0,endCodePoint:100}]}),[]);
 assert.deepEqual(select({...input,facts:facts.map(f=>f.factId==='person'?{...f,status:'conflict'}:f)}),[]);
 assert.deepEqual(select({...input,knownRanges:[{chapterId:'ch-1',startCodePoint:10,endCodePoint:17},{chapterId:'ch-1',startCodePoint:18,endCodePoint:40}]}),[]);
 const before=JSON.stringify(entries);select(input);assert.equal(JSON.stringify(entries),before);
});
