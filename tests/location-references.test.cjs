const test=require('node:test'),assert=require('node:assert/strict');
const {createPublishedLocationIndex,normalizeSituationLocations}=require('../dist/application/content/locationReferences');
const scene=(entryId,locationId)=>({entryId,kind:'scene',definition:{locationId}});
const entity={worldId:'w',entityId:'ent-bridge',type:'location',name:'旧桥',aliases:[]};
const at=id=>({kind:'actor_at',actorId:'actor-player',locationId:id});

test('location resolution preserves prose and inputs while covering movement, requirements, visibility and reference conditions',()=>{
  const entries=[scene('scene-bridge','旧桥')],index=createPublishedLocationIndex(entries,[entity]);
  const definition={title:'ent-bridge 原文保持原样',summary:'scene-bridge 只是文字',locationId:'ent-bridge',activation:at('ent-bridge'),
    knowledgeCondition:{kind:'not',of:at('scene-bridge')},methods:[{methodId:'m',firstStep:{intent:'前往旧桥',actionKind:'move',destinationId:'scene-bridge'},
      requires:{actorAt:{actorId:'actor-player',locationId:'ent-bridge'},condition:at('scene-bridge')},visibility:at('旧桥')}],
    referenceEvents:[{eventKey:'e',condition:{kind:'any',of:[at('ent-bridge')]}}],transitions:{}};
  const original=JSON.stringify({entries,definition});
  const resolved=normalizeSituationLocations(definition,index),d=resolved.definition;
  assert.equal(d.locationId,'旧桥');assert.equal(d.activation.locationId,'旧桥');assert.equal(d.knowledgeCondition.of.locationId,'旧桥');
  assert.equal(d.methods[0].firstStep.destinationId,'旧桥');assert.equal(d.methods[0].requires.actorAt.locationId,'旧桥');
  assert.equal(d.methods[0].requires.condition.locationId,'旧桥');assert.equal(d.methods[0].visibility.locationId,'旧桥');
  assert.equal(d.referenceEvents[0].condition.of[0].locationId,'旧桥');
  assert.equal(d.title,definition.title);assert.equal(d.summary,definition.summary);assert.equal(d.activation.actorId,'actor-player');
  assert.deepEqual(resolved.sceneEntryIds,['scene-bridge']);assert.deepEqual(resolved.unresolvedLocations,[]);
  assert.equal(JSON.stringify({entries,definition}),original);
});

test('an entity without a catalog scene, a non-scene entry and an ambiguous alias cannot certify a destination',()=>{
  const index=createPublishedLocationIndex([{entryId:'lore-place',kind:'lore',definition:{name:'不存在'}},
    scene('scene-a','旧桥'),scene('scene-b','scene-a')],[entity,{...entity,entityId:'ent-absent',name:'不存在'}]);
  assert.equal(index.has('ent-absent'),false);assert.equal(index.has('lore-place'),false);assert.equal(index.has('scene-a'),false);
  const result=normalizeSituationLocations({activation:at('scene-a'),methods:[{firstStep:{intent:'走过去',actionKind:'move',destinationId:'ent-absent'},requires:{}}]},index);
  assert.deepEqual(result.unresolvedLocations,['scene-a','ent-absent']);assert.deepEqual(result.sceneEntryIds,[]);
});

test('multiple certified scene versions of one coordinate retain their full dependency closure',()=>{
  const index=createPublishedLocationIndex([scene('scene-base','旧桥'),scene('scene-segment','旧桥')],[entity]);
  const result=normalizeSituationLocations({locationId:'ent-bridge',activation:{kind:'world_time_at_least',order:1},methods:[]},index);
  assert.equal(result.definition.locationId,'旧桥');assert.deepEqual(result.sceneEntryIds,['scene-base','scene-segment']);
});
