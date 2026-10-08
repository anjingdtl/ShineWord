const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,sha,now}=require('./helpers/phase6PublicationFixture.cjs');
const {SituationReviewService}=require('../dist/application/worldPackage/situationReviewService');
const {createMappingSituationReview}=require('../dist/application/worldPackage/mappingSituationReview');
const {buildPackageFromCanon}=require('../dist/application/worldPackage/buildPackageFromCanon');

async function harness(patch={}) {
  const h=await fixture();
  const fact=(await h.worldStore.listFacts(h.worldId)).find(f=>f.status==='explicit');
  const raw={id:'cached-lights',title:'核对脚步声',summary:'在巷口辨认来人。',gmBrief:'来人身份还需要调查。',
    locationId:'scene-progressive-opening',participantIds:[],activation:{kind:'world_time_at_least',order:0},
    provenanceKind:'design_fill',evidenceFactIds:[fact.factId],rationale:'从已证实的巷口场景组织局面。',
    methods:[{id:'observe',title:'查看来路',goal:'了解现场',firstStep:{actionKind:'observe',intent:'查看灯下的来路'},requires:{},tradeoffs:'需要时间'},
      {id:'listen',title:'辨认声音',goal:'了解脚步',firstStep:{actionKind:'skill_check',skillId:'skill-observation',intent:'辨认远处脚步声'},
        requires:{},tradeoffs:'可能暴露自己',evidenceFactIds:[fact.factId]}],...patch};
  const issueId='situation-dangling-situation-cached-lights';
  await h.worldStore.saveReviewIssue({worldId:h.worldId,issueId,kind:'situation_dangling_reference',severity:'major',
    detailJson:JSON.stringify({situationId:'situation-cached-lights',dangling:['old-unpublished-location']}),createdAt:now});
  await h.worldStore.upsertJob({worldId:h.worldId,jobId:'paid-map',kind:'rule_mapping',targetId:null,status:'done',attempts:1,
    contentHash:sha.sha256Hex('paid-input'),extractorVersion:'mapper-fixture',modelFingerprint:'fixture',usageJson:'{"outputTokens":20}',
    resultJson:JSON.stringify({proposal:{skills:[],constraints:[],lore:[],situations:[raw]}}),error:null,createdAt:now,updatedAt:now},now);
  return {...h,raw,fact,issueId,review:new SituationReviewService(h.service)};
}
const rows=h=>Object.fromEntries(['world_jobs','canon_facts','fact_sources','world_packages','package_entries','snapshots','campaigns']
  .map(table=>[table,h.db.raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));

test('cached recovery uses M5 and atomically publishes a new situation without adopting it or editing paid and historical inputs',async()=>{
  const h=await harness();try{
    const before=rows(h),p=await h.review.prepare(h.worldId,h.issueId);
    assert.equal(p.ready,true,JSON.stringify(p.errors));
    const artifact=await h.review.publish(h.worldId,h.issueId,p.proofHash);
    assert.equal(artifact.entries.length,1);assert.equal(artifact.entries[0].definition.locationId,'opening-location');
    assert.ok(artifact.entries[0].dependencyIds.includes('scene-progressive-opening'));
    assert.deepEqual(rows(h),before);
    assert.equal((await h.worldStore.listReviewIssues(h.worldId)).length,0);
    const audit=h.db.raw.prepare("SELECT detail_json FROM review_issues WHERE kind='situation_mapping_decision'").get();
    assert.equal(JSON.parse(audit.detail_json).artifactId,artifact.artifactId);
    await assert.rejects(h.review.publish(h.worldId,h.issueId,p.proofHash),/刷新/);
    assert.equal((await h.store.listArtifacts(h.worldId)).length,1);
    const frozen=await h.service.freezeBinding(h.campaign.campaignId,h.campaign.branchId);
    const adoption=await h.service.adoptAtSafeBoundary({campaignId:h.campaign.campaignId,branchId:h.campaign.branchId,
      expectedStateVersion:0,expectedManifestHash:frozen.manifestHash,artifactIds:[artifact.artifactId]});
    assert.equal(adoption.status,'adopted');
    const catalog=await h.service.loadEffectiveCatalog({campaignId:h.campaign.campaignId,branchId:h.campaign.branchId});
    assert.ok(catalog.entries.some(e=>e.entryId==='situation-cached-lights'));
  }finally{h.db.raw.close();}
});

test('missing locations stay unpublished until an actual scene dependency exists, then recovery binds that immutable artifact',async()=>{
  const h=await harness({locationId:'ent-world-publication-safety-opening-location'});try{
    const p=await h.review.prepare(h.worldId,h.issueId);assert.equal(p.ready,false);
    assert.ok(p.errors.some(e=>e.startsWith('missing_dependency:')));
    await assert.rejects(h.review.publish(h.worldId,h.issueId,p.proofHash),/尚未通过/);
    assert.equal((await h.store.listArtifacts(h.worldId)).length,0);
    const scene=structuredClone(h.base.entries.find(e=>e.kind==='scene'));
    scene.entryId='scene-evidenced-location';scene.definition.locationId='青石巷';
    const dependency=await h.service.publishArtifact(await h.draft({entries:[scene],sections:[]}));
    await assert.rejects(h.review.publish(h.worldId,h.issueId,p.proofHash),/变化|刷新/);
    const fresh=await h.review.prepare(h.worldId,h.issueId);assert.equal(fresh.ready,true,JSON.stringify(fresh.errors));
    const recovered=await h.review.publish(h.worldId,h.issueId,fresh.proofHash);
    assert.deepEqual(recovered.dependencies,[{artifactId:dependency.artifactId,contentHash:dependency.contentHash}]);
    assert.equal(recovered.entries[0].definition.locationId,'青石巷');
    assert.deepEqual(await h.store.getArtifact(dependency.artifactId),dependency);
  }finally{h.db.raw.close();}
});

test('changed evidence, full paid payload, issue, source, and competing publication invalidate shown decisions',async()=>{
  for(const change of ['fact','job','issue','source','artifact']) {
    const h=await harness();try{
      const p=await h.review.prepare(h.worldId,h.issueId);
      if(change==='fact')await h.db.execute('UPDATE canon_facts SET value_json=? WHERE fact_id=?',['{"changed":true}',h.fact.factId]);
      if(change==='job')await h.db.execute('UPDATE world_jobs SET result_json=? WHERE job_id=?',[JSON.stringify({proposal:{situations:[{...h.raw,gmBrief:'changed'}]}}),'paid-map']);
      if(change==='issue')await h.db.execute('UPDATE review_issues SET detail_json=? WHERE issue_id=?',[JSON.stringify({situationId:'situation-cached-lights',dangling:['changed']}),h.issueId]);
      if(change==='source')await h.db.execute('UPDATE worlds SET source_sha256=? WHERE world_id=?',['b'.repeat(64),h.worldId]);
      if(change==='artifact')await h.service.publishArtifact(await h.draft());
      await assert.rejects(h.review.reject(h.worldId,h.issueId,p.proofHash),/变化|刷新/);
      assert.equal(h.db.raw.prepare('SELECT COUNT(*) n FROM review_resolution_policies').get().n,0);
      assert.equal((await h.worldStore.listReviewIssues(h.worldId)).find(i=>i.issueId===h.issueId).status,'open');
    }finally{h.db.raw.close();}
  }
});

test('publication decision failure rolls back the artifact and keeps review open; a race cannot publish stale evidence',async()=>{
  const h=await harness();try{
    const p=await h.review.prepare(h.worldId,h.issueId),execute=h.db.execute.bind(h.db);
    h.db.execute=async(sql,params)=>{if(sql.includes("'situation_mapping_decision'"))throw Error('injected_decision_failure');return execute(sql,params);};
    await assert.rejects(h.review.publish(h.worldId,h.issueId,p.proofHash),/injected_decision_failure/);
    assert.equal((await h.store.listArtifacts(h.worldId)).length,0);
    assert.equal((await h.worldStore.listReviewIssues(h.worldId)).find(i=>i.issueId===h.issueId).status,'open');
    h.db.execute=execute;
    const publish=h.service.publishArtifact.bind(h.service);
    h.service.publishArtifact=async input=>{
      h.db.beforeTransaction=()=>h.db.execute('UPDATE canon_facts SET value_json=? WHERE fact_id=?',['{"raced":true}',h.fact.factId]);
      return publish(input);
    };
    await assert.rejects(h.review.publish(h.worldId,h.issueId,p.proofHash),/canon_evidence_changed|变化|刷新/);
    assert.equal((await h.store.listArtifacts(h.worldId)).length,0);
  }finally{h.db.raw.close();}
});

test('formal rejection seals recursive evidence and full proposal while preserving canon and paid payload; changed content never inherits it',async()=>{
  const h=await harness({locationId:'missing-location'});try{
    const before=rows(h),p=await h.review.prepare(h.worldId,h.issueId);
    assert.equal(p.ready,false);await h.review.reject(h.worldId,h.issueId,p.proofHash);
    assert.deepEqual(rows(h),before);assert.equal((await h.store.listArtifacts(h.worldId)).length,0);
    const exact=createMappingSituationReview(h.raw,h.worldId,h.base.manifest.sourceSha256,await h.worldStore.listFacts(h.worldId));
    assert.equal(await h.worldStore.isMappingSituationRejected(h.worldId,JSON.stringify(exact)),true);
    assert.equal(await h.worldStore.isMappingSituationRejected(h.worldId,JSON.stringify({...exact,proposal:{...exact.proposal,gmBrief:'new'}})),false);
    assert.equal(await h.worldStore.isMappingSituationRejected(h.worldId,JSON.stringify({...exact,sourceSha256:'b'.repeat(64)})),false);
    const modifiedFacts=(await h.worldStore.listFacts(h.worldId)).map(f=>f.factId===h.fact.factId?{...f,status:'inference'}:f);
    assert.equal(await h.worldStore.isMappingSituationRejected(h.worldId,JSON.stringify(createMappingSituationReview(h.raw,h.worldId,h.base.manifest.sourceSha256,modifiedFacts))),false);
    await assert.rejects(h.review.reject(h.worldId,h.issueId,p.proofHash),/刷新/);
  }finally{h.db.raw.close();}
});

test('ordinary close/waive cannot substitute for a situation decision, and a late paid-proposal race rolls back publication',async()=>{
  const h=await harness();try{
    await assert.rejects(h.worldStore.resolveReviewIssue(h.worldId,h.issueId,'resolved'),/补充发布或拒绝/);
    await assert.rejects(h.worldStore.resolveReviewIssue(h.worldId,h.issueId,'waived',false),/补充发布或拒绝/);
    const p=await h.review.prepare(h.worldId,h.issueId),publish=h.service.publishArtifact.bind(h.service);
    h.service.publishArtifact=async input=>{
      h.db.beforeTransaction=()=>h.db.execute('UPDATE world_jobs SET result_json=? WHERE job_id=?',
        [JSON.stringify({proposal:{situations:[{...h.raw,gmBrief:'changed at final fence'}]}}),'paid-map']);
      return publish(input);
    };
    await assert.rejects(h.review.publish(h.worldId,h.issueId,p.proofHash),/变化|刷新/);
    assert.equal((await h.store.listArtifacts(h.worldId)).length,0);
    assert.equal((await h.worldStore.listReviewIssues(h.worldId)).find(i=>i.issueId===h.issueId).status,'open');
    assert.equal(h.db.raw.prepare("SELECT COUNT(*) n FROM review_issues WHERE kind='situation_mapping_decision'").get().n,0);
  }finally{h.db.raw.close();}
});

test('mapper honors an exact situation decision when compiling a paid checkpoint again without another model request',async()=>{
  const h=await fixture();try{
    let calls=0;
    const raw={id:'repeat-review',title:'依赖未齐的提案',summary:'需要原著地点',gmBrief:'设计局面',locationId:'missing-scene',participantIds:[],
      activation:{kind:'world_time_at_least',order:0},provenanceKind:'design_fill',evidenceFactIds:[],rationale:'设计提案',
      methods:[{id:'a',title:'观察',goal:'查看',firstStep:{actionKind:'observe',intent:'观察'}},{id:'b',title:'交谈',goal:'询问',firstStep:{actionKind:'talk',intent:'交谈'}}]};
    const input={worldStore:h.worldStore,worldId:h.worldId,sha256Hex:sha.sha256Hex,sourceSha256:h.base.manifest.sourceSha256,
      mappingVersion:'decision-mapper',createdAt:now,provider:{async complete(){calls++;return {text:JSON.stringify({skills:[],constraints:[],lore:[],situations:[raw]})};}}};
    await buildPackageFromCanon(input);
    const issue=(await h.worldStore.listReviewIssues(h.worldId)).find(i=>i.kind==='situation_dangling_reference');assert.ok(issue);
    const review=new SituationReviewService(h.service),p=await review.prepare(h.worldId,issue.issueId);
    await review.reject(h.worldId,issue.issueId,p.proofHash);
    const paid=await h.db.queryAll("SELECT * FROM world_jobs WHERE kind='rule_mapping' ORDER BY job_id");
    const result=await buildPackageFromCanon(input);
    assert.equal(calls,1);assert.equal(result.entries.some(e=>e.entryId==='situation-repeat-review'),false);
    assert.deepEqual(await h.db.queryAll("SELECT * FROM world_jobs WHERE kind='rule_mapping' ORDER BY job_id"),paid);
    assert.equal((await h.worldStore.listReviewIssues(h.worldId)).some(i=>i.kind==='situation_dangling_reference'),false);
  }finally{h.db.raw.close();}
});
