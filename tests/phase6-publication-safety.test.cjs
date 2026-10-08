'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture,lore,sha,now}=require('./helpers/phase6PublicationFixture.cjs');
const {validateSegmentArtifactContent,buildSegmentCitations}=require('../dist/application/segmentPublication');
test('publication guard executes in the write transaction and fences replaced leases, generations, cancellation and expiry',async()=>{
  for(const update of ['fence = 8','generation = 2','canceled = 1',"expires_at = '2026-10-01T00:00:00.000Z'"]){
    const h=await fixture();try{await h.db.execute(`UPDATE publication_authority SET ${update}`);
      await assert.rejects(h.service.publishArtifact(await h.draft({assertCurrent:h.leaseGuard})),/stale_publication_authority/);
      assert.equal((await h.store.listArtifacts(h.worldId)).length,0);
      assert.equal((await h.db.queryOne('SELECT COUNT(*) n FROM segment_publication_diagnostics')).n,1);
    }finally{h.db.raw.close();}}
});
test('publication guard side effects roll back with failure and stale retries cannot bypass the guard through deduplication',async()=>{
  const h=await fixture();try{
    await assert.rejects(h.service.publishArtifact(await h.draft({assertCurrent:async tx=>{await h.leaseGuard(tx);throw new Error('after_fence_fault');}})),/after_fence_fault/);
    assert.equal((await h.db.queryOne('SELECT COUNT(*) n FROM guard_effect')).n,0);
    const artifact=await h.service.publishArtifact(await h.draft({assertCurrent:h.leaseGuard}));
    assert.equal((await h.db.queryOne('SELECT COUNT(*) n FROM guard_effect')).n,1);
    await h.db.execute('UPDATE publication_authority SET fence = 8');
    await assert.rejects(h.service.publishArtifact(await h.draft({assertCurrent:h.leaseGuard})),/stale_publication_authority/);
    assert.equal((await h.store.listArtifacts(h.worldId)).length,1);assert.equal((await h.store.getArtifact(artifact.artifactId)).artifactId,artifact.artifactId);
  }finally{h.db.raw.close();}
});
test('publication rechecks canon evidence and blocking reviews inside its transaction after parallel validation changes',async()=>{
  for(const change of ['conflict','value','review']){const h=await fixture();try{
    const fact=(await h.worldStore.listFacts(h.worldId)).find(f=>f.status==='explicit'&&f.sources.length);
    const draft=await h.draft({entries:[lore('cited-proof',[fact.factId])],sections:[]});
    h.db.beforeTransaction=async()=>{
      if(change==='conflict')await h.db.execute("UPDATE canon_facts SET status = 'conflict' WHERE world_id = ? AND fact_id = ?",[h.worldId,fact.factId]);
      else if(change==='value')await h.db.execute('UPDATE canon_facts SET value_json = ? WHERE world_id = ? AND fact_id = ?',['{"text":"changed after validation"}',h.worldId,fact.factId]);
      else await h.db.execute(`INSERT INTO review_issues (world_id,issue_id,kind,severity,detail_json,status,created_at)
        VALUES (?,'late-blocker','late_review','blocking','{}','open',?)`,[h.worldId,now]);
    };
    await assert.rejects(h.service.publishArtifact(draft),change==='conflict'?/canon_conflict_in_scope/:change==='value'?/canon_evidence_changed/:/blocking_review:late-blocker/);
    if(change==='conflict') {
      const issue=(await h.worldStore.listReviewIssues(h.worldId)).find(i=>i.kind==='canon_conflict');
      assert.ok(issue, 'a conflict detected at the final fence must be reachable from review');
      assert.deepEqual(JSON.parse(issue.detailJson).factIds,[fact.factId]);
    }
    assert.equal((await h.store.listArtifacts(h.worldId)).length,0);
  }finally{h.db.raw.close();}}
});

test('publication coverage conflicts enter evidence review and can resume through formal fact resolution',async()=>{
  const h=await fixture();try{
    const fact=(await h.worldStore.listFacts(h.worldId)).find(f=>f.status==='explicit'&&f.sources.length);
    await h.db.execute("UPDATE canon_facts SET status='conflict' WHERE world_id=? AND fact_id=?",[h.worldId,fact.factId]);
    const draft=await h.draft();
    await assert.rejects(h.service.publishArtifact(draft),/Canon blocking conflict.*canon_conflict_in_scope/);
    const issue=(await h.worldStore.listReviewIssues(h.worldId)).find(i=>i.kind==='canon_conflict');
    assert.ok(issue);
    assert.deepEqual(JSON.parse(issue.detailJson).factIds,[fact.factId]);
    assert.equal((await h.store.listArtifacts(h.worldId)).length,0);
    await h.worldStore.resolveCanonFactConflict(h.worldId,fact.factId,'complementary');
    const artifact=await h.service.publishArtifact(draft);
    assert.ok(artifact.artifactId);
    assert.deepEqual((await h.worldStore.listFacts(h.worldId)).find(f=>f.factId===fact.factId).sources,fact.sources);
  }finally{h.db.raw.close();}
});

test('a stale publication owner cannot create a new canon review',async()=>{
  const h=await fixture();try{
    const fact=(await h.worldStore.listFacts(h.worldId)).find(f=>f.status==='explicit'&&f.sources.length);
    await h.db.execute("UPDATE canon_facts SET status='conflict' WHERE world_id=? AND fact_id=?",[h.worldId,fact.factId]);
    await h.db.execute('UPDATE publication_authority SET fence=8');
    await assert.rejects(h.service.publishArtifact(await h.draft({assertCurrent:h.leaseGuard})),/stale_publication_authority/);
    assert.equal((await h.worldStore.listReviewIssues(h.worldId)).length,0);
    assert.equal((await h.store.listArtifacts(h.worldId)).length,0);
  }finally{h.db.raw.close();}
});
test('legacy lookup rebases the adopted artifact overlay atomically without editing actor state or admitting future facts',async()=>{
  const h=await fixture();try{const adopted=await h.adopt();assert.equal(adopted.status,'adopted');
    const before=JSON.parse((await h.db.queryOne('SELECT snapshot_json FROM snapshots WHERE branch_id = ?',[h.campaign.branchId])).snapshot_json);
    const published=await h.lookup({rebaseLegacyOverlay:(tx,input)=>h.service.rebaseLegacyOverlay(tx,input)});
    assert.equal(published.status,'published');const rebased=published.publication.segmentContentBinding;
    assert.deepEqual(rebased.artifactIds,adopted.binding.artifactIds);assert.notEqual(rebased.manifestHash,adopted.binding.manifestHash);
    assert.notEqual(rebased.artifactManifestHash,adopted.binding.artifactManifestHash);
    const after=JSON.parse((await h.db.queryOne('SELECT snapshot_json FROM snapshots WHERE branch_id = ?',[h.campaign.branchId])).snapshot_json);
    assert.deepEqual(after.actors,before.actors);assert.equal(after.clockMinutes,before.clockMinutes);assert.deepEqual(after.segmentContentBinding,rebased);
    const catalog=await h.service.loadEffectiveCatalog({campaignId:h.campaign.campaignId,branchId:h.campaign.branchId});
    const quote=catalog.entries.find(entry=>published.entryIds.includes(entry.entryId));
    assert.equal(quote.visibility,'discoverable');assert.equal(quote.revealPolicyId,'source-lookup-confirmation');
    assert.equal(quote.provenance.sourceFactIds.length,0);assert.equal((await h.service.freezeBinding(h.campaign.campaignId,h.campaign.branchId)).artifactManifestHash,rebased.artifactManifestHash);
    await assert.rejects(h.service.loadEffectiveCatalog({campaignId:h.campaign.campaignId,branchId:h.campaign.branchId,
      binding:{...rebased,deltaIds:[]}}),/legacy_binding_changed/);
    await assert.rejects(h.service.loadEffectiveCatalog({campaignId:h.campaign.campaignId,branchId:h.campaign.branchId,
      binding:{...rebased,deltaIds:[...rebased.deltaIds,...rebased.deltaIds]}}),/invalid_artifact_binding/);
  }finally{h.db.raw.close();}
});
test('missing legacy bridge, active interaction, staged turn and snapshot write faults roll back both delta and overlay publication',async()=>{
  for(const failure of ['missing_bridge','interaction','staged_turn','snapshot_fault']){const h=await fixture();try{await h.adopt();
    const before=await h.service.freezeBinding(h.campaign.campaignId,h.campaign.branchId);
    if(failure==='interaction')await h.db.execute(`INSERT INTO interaction_operations (operation_id,campaign_id,branch_id,operation_kind,status,
      expected_state_version,fence_token,next_step,max_steps,created_at,updated_at)
      VALUES ('op',?,?,'encounter_auto','running',0,1,0,1,?,?)`,[h.campaign.campaignId,h.campaign.branchId,now,now]);
    if(failure==='staged_turn')await h.db.execute(`INSERT INTO turns (branch_id,turn_id,status,expected_state_version,action_contract_json,action_contract_hash,created_at)
      VALUES (?,'turn-pending','Resolved',0,'{}',?,?)`,[h.campaign.branchId,sha.sha256Hex('{}'),now]);
    if(failure==='snapshot_fault')h.db.failSnapshot=true;
    await assert.rejects(h.lookup(failure==='missing_bridge'?{}:{rebaseLegacyOverlay:(tx,input)=>h.service.rebaseLegacyOverlay(tx,input)}),
      failure==='missing_bridge'?/atomic legacy overlay rebase/:['interaction','staged_turn'].includes(failure)?/interaction_running/:/injected_snapshot_failure/);
    assert.equal((await h.db.queryOne('SELECT COUNT(*) n FROM progressive_world_deltas')).n,0);
    assert.equal((await h.db.queryOne('SELECT COUNT(*) n FROM branch_content_manifests')).n,1);
    assert.equal((await h.service.freezeBinding(h.campaign.campaignId,h.campaign.branchId)).artifactManifestHash,before.artifactManifestHash);
  }finally{h.db.raw.close();}}
});
test('world-ready artifact stays pending during a frozen ordinary turn',async()=>{
  const h=await fixture();try{const artifact=await h.service.publishArtifact(await h.draft());
    const frozen=await h.service.freezeBinding(h.campaign.campaignId,h.campaign.branchId);
    await h.db.execute(`INSERT INTO turns (branch_id,turn_id,status,expected_state_version,action_contract_json,action_contract_hash,created_at)
      VALUES (?,'turn-frozen','AwaitRoll',0,'{}',?,?)`,[h.campaign.branchId,sha.sha256Hex('{}'),now]);
    const receipt=await h.service.adoptAtSafeBoundary({campaignId:h.campaign.campaignId,branchId:h.campaign.branchId,expectedStateVersion:0,
      expectedManifestHash:frozen.manifestHash,artifactIds:[artifact.artifactId]});
    assert.equal(receipt.status,'pending');assert.equal(receipt.reason,'interaction_running');assert.deepEqual(receipt.binding.artifactIds,[]);
    assert.equal((await h.store.listArtifacts(h.worldId)).length,1);
  }finally{h.db.raw.close();}
});
test('missing ordinary-turn journal fails closed instead of allowing adoption',async()=>{
  const h=await fixture();try{const artifact=await h.service.publishArtifact(await h.draft());
    const frozen=await h.service.freezeBinding(h.campaign.campaignId,h.campaign.branchId);
    await h.db.execute('DROP TABLE turns');
    await assert.rejects(h.service.adoptAtSafeBoundary({campaignId:h.campaign.campaignId,branchId:h.campaign.branchId,expectedStateVersion:0,
      expectedManifestHash:frozen.manifestHash,artifactIds:[artifact.artifactId]}),/no such table: turns/);
    assert.deepEqual((await h.service.freezeBinding(h.campaign.campaignId,h.campaign.branchId)).artifactIds,[]);
  }finally{h.db.raw.close();}
});
async function playableEvidence(h){
  const quote='甲在城门，灯火照亮来人。',prefix='巷口的灯还亮着。远处传来脚步声。她循声望去。';
  const range=await h.catalog.createRange(h.sourceId,prefix.length,prefix.length+quote.length);
  const sourceText=await h.catalog.readRange(range);
  const entities=[{worldId:h.worldId,entityId:'character-a',type:'character',name:'甲',aliases:[],firstSeenChapterId:'opening'},
    {worldId:h.worldId,entityId:'location-a',type:'location',name:'城门',aliases:[],firstSeenChapterId:'opening'}];
  const facts=Array.from({length:20},(_,i)=>({worldId:h.worldId,factId:`fact-${i}`,subjectEntityId:i===19?'location-a':'character-a',predicate:i===0?'current_location':`detail-${i}`,
    value:i===0?{locationId:'location-a'}:{text:`核验事实 ${i}`},status:'explicit',confidence:1,validFrom:null,validTo:null,revealAt:null,scope:'world',
    sources:[{chapterId:'opening',startOffset:range.startCp,endOffset:range.endCp,quote:sourceText,quoteSha256:range.rangeContentHash}]}));
  const entries=facts.map(f=>lore(`lore-${f.factId}`,[f.factId]));
  entries.push({...lore('npc-a',['fact-0']),kind:'actor_template',provenance:{kind:'rule_mapping',sourceFactIds:['fact-0'],rationale:'有事实依据的规则映射'},
    definition:{name:'甲',category:'human',description:'守门人',hp:10,defense:2,stamina:5,attributes:{},skills:{},attacks:[],abilities:[],behavior:{goal:'守门',morale:'steady',retreatThreshold:0.2},lootPolicy:'none'}});
  entries.push({...lore('scene-a',['fact-19']),kind:'scene',visibility:'public',dependencyIds:['npc-a'],definition:{name:'城门',locationId:'location-a',
    zones:[{zoneId:'gate',name:'城门',cover:false,exits:[]}],actors:['npc-a'],visibleItems:[],hazards:[],clues:[]}});
  const events=[{worldId:h.worldId,eventId:'event-a',title:'有人到来',summary:'来人现身',worldTimeOrder:0,narrativeChapterId:'opening',validFrom:null,
    validTo:null,status:'canon',dependsOnEventIds:[]}];
  const artifact={...await h.draft({entries,sections:[],coverage:[range]}),schemaVersion:'shineword-segment-artifact-1',validationVersion:'segment-validation-1',
    artifactId:'artifact-playable',contentHash:sha.sha256Hex('test-playable'),dependencies:[],citations:await buildSegmentCitations({worldId:h.worldId,entries,facts,
      catalog:h.catalog,sourceBinding:(await h.catalog.snapshot(h.worldId)).binding}),validation:{warnings:[]}};
  const openingRequirements={requiredEntityIds:entities.map(e=>e.entityId),requiredFactIds:facts.map(f=>f.factId),requiredEventIds:['event-a'],
    requiredEntryIds:['scene-a'],ranges:[range]};
  return {artifact,dependencyEntries:[],facts,entities,events,blockingReviews:[],openingRequirements};
}
test('opening accepts unique canonical location names or IDs and rejects unsupported entities, events and generic actors',async()=>{
  const h=await fixture();try{const input=await playableEvidence(h);
    assert.deepEqual(validateSegmentArtifactContent(input).errors,[]);
    const named=structuredClone(input);named.artifact.entries.find(e=>e.kind==='scene').definition.locationId='城门';
    assert.deepEqual(validateSegmentArtifactContent(named).errors,[]);
    const unproven=structuredClone(input);unproven.entities.push({...input.entities[0],entityId:'future-person'});unproven.openingRequirements.requiredEntityIds.push('future-person');
    assert.ok(validateSegmentArtifactContent(unproven).errors.includes('opening_entity_unproven:future-person'));
    const futureEvent=structuredClone(input);futureEvent.events[0].narrativeChapterId='later';
    assert.ok(validateSegmentArtifactContent(futureEvent).errors.includes('opening_event_missing:event-a'));
    const dependent=structuredClone(input);dependent.events[0].dependsOnEventIds=['future-event'];
    assert.ok(validateSegmentArtifactContent(dependent).errors.includes('opening_event_dependency_missing:event-a:future-event'));
    const generic=structuredClone(input),actor=generic.artifact.entries.find(e=>e.kind==='actor_template');
    actor.provenance={kind:'design_fill',sourceFactIds:[],rationale:'通用守卫'};
    generic.artifact.citations.find(c=>c.entryId===actor.entryId).sourceFactIds=[];
    assert.ok(validateSegmentArtifactContent(generic).errors.includes('opening_interaction_missing'));
    const ambiguous=structuredClone(named);ambiguous.entities.push({...input.entities[1],entityId:'other-gate'});
    assert.ok(validateSegmentArtifactContent(ambiguous).errors.includes('opening_location_unproven'));
  }finally{h.db.raw.close();}
});
