const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./helpers/phase9CampaignFixture.cjs');
const {forkBranch}=require('../dist/application/branch/fork');
const {exportSave,restoreSave,validateSaveJson}=require('../dist/application/export/saveFile');
const {sha}=require('./helpers/mobileHarness.cjs');
const {SqliteGameStore}=require('../dist/infra/sqlite/sqliteGameStore');
const {SqliteSourceStore}=require('../dist/infra/sqlite/sqliteSourceStore');
const {publishUserRequestedSourceLookupDelta}=require('../dist/application/worldPackage/progressiveDelta');

test('a historical campaign fork exports inherited frozen contracts with their actual pre-turn snapshots',async t=>{
 const h=await fixture();t.after(()=>h.db.close());
 await h.session.playTurn({campaignId:h.campaignId,branchId:h.branchId,intent:'向林凡打听青石巷最近的情况'});
 const point=await h.turns.getState(h.branchId);
 await h.session.changeCampaignGoal({campaignId:h.campaignId,branchId:h.branchId,newGoal:'源分支将来独有的目标'});
 const sourceBefore=h.db.prepare('select * from snapshots where branch_id=? order by state_version').all(h.branchId);
 const fork=await forkBranch({db:h.adapter,turnStore:h.turns,gameStore:new SqliteGameStore(h.adapter),sourceBranchId:h.branchId,
  targetBranchId:h.branchId+'-history',campaignId:h.campaignId,forkTurnId:'turn-0001',atStateVersion:point.stateVersion,createdAt:'2026-10-09T07:00:00Z'});
 const rows=h.db.prepare('select state_version,snapshot_json from snapshots where branch_id=? order by state_version').all(fork.snapshot.branchId);
 assert.deepEqual(rows.map(r=>r.state_version),sourceBefore.filter(r=>r.state_version<=point.stateVersion).map(r=>r.state_version),'all pre-fork authority snapshots accompany the inherited contracts, with no future snapshot');
 for(const row of rows){const state=JSON.parse(row.snapshot_json);assert.equal(state.branchId,fork.snapshot.branchId);assert.equal(state.campaignRuntime?.branchId,fork.snapshot.branchId);}
 const saved=await exportSave({db:h.adapter,sha256Hex:sha.sha256Hex,campaignId:h.campaignId,branchId:fork.snapshot.branchId,createdAt:'2026-10-09T07:00:00Z'});
 const checked=await validateSaveJson(saved.json,sha.sha256Hex);assert.equal(checked.ok,true,JSON.stringify(checked.errors));
 assert.deepEqual(h.db.prepare('select * from snapshots where branch_id=? order by state_version').all(h.branchId),sourceBefore,'source history remains byte-for-byte unchanged');
 assert.deepEqual(h.db.prepare('select action_contract_json,action_contract_hash from turns where branch_id=? order by committed_state_version').all(fork.snapshot.branchId),
  h.db.prepare("select action_contract_json,action_contract_hash from turns where branch_id=? and status='Committed' and committed_state_version<=? order by committed_state_version").all(h.branchId,point.stateVersion),'inherited paid contracts remain exact, not rebound by editing their bytes');
 const target=await fixture();t.after(()=>target.db.close());
 await restoreSave({db:target.adapter,sha256Hex:sha.sha256Hex,save:saved.save,newCampaignId:'restored-history',newBranchId:'restored-history-main',createdAt:'2026-10-09T07:01:00Z'});
 const restored=await exportSave({db:target.adapter,sha256Hex:sha.sha256Hex,campaignId:'restored-history',branchId:'restored-history-main',createdAt:'2026-10-09T07:02:00Z'});
 assert.equal((await validateSaveJson(restored.json,sha.sha256Hex)).ok,true);
 assert.equal(restored.save.manifest.stateVersion,point.stateVersion);
});

test('failure while copying a historical snapshot rolls back the whole fork and preserves the parent',async t=>{
 const h=await fixture();t.after(()=>h.db.close());
 await h.session.playTurn({campaignId:h.campaignId,branchId:h.branchId,intent:'向林凡打听青石巷最近的情况'});
 const before=h.db.prepare('select * from snapshots where branch_id=? order by state_version').all(h.branchId);
 const db={queryOne:h.adapter.queryOne.bind(h.adapter),queryAll:h.adapter.queryAll.bind(h.adapter),execute:h.adapter.execute.bind(h.adapter),
  transaction:work=>h.adapter.transaction(tx=>work({queryOne:tx.queryOne.bind(tx),queryAll:tx.queryAll.bind(tx),execute:async(sql,args)=>{
   if(/INSERT INTO snapshots/.test(sql)&&args[0]===h.branchId+'-rollback'&&args[1]===0)throw Error('injected history write failure');
   return tx.execute(sql,args);
  }}))};
 await assert.rejects(()=>forkBranch({db,turnStore:h.turns,gameStore:new SqliteGameStore(h.adapter),sourceBranchId:h.branchId,
  targetBranchId:h.branchId+'-rollback',campaignId:h.campaignId,forkTurnId:'turn-0001',createdAt:'2026-10-09T07:00:00Z'}),/injected history write failure/);
 for(const table of ['branches','snapshots','turns','actor_states','branch_content_manifests'])assert.equal(h.db.prepare('select count(*) n from '+table+' where branch_id=?').get(h.branchId+'-rollback').n,0);
 assert.deepEqual(h.db.prepare('select * from snapshots where branch_id=? order by state_version').all(h.branchId),before);
});

test('a fork preserves content generations published between the pre-turn snapshot and contract freeze',async t=>{
 const h=await fixture({sections:[{book:'player_handbook',sectionKey:'clues',title:'线索',entryIds:['lore-crates'],position:0}]});t.after(()=>h.db.close());
 const sources=new SqliteSourceStore(h.adapter);
 const pkg=await h.worlds.getWorldPackage('w',1);
 const before=h.db.prepare('select snapshot_json from snapshots where branch_id=? and state_version=0').get(h.branchId).snapshot_json;
 const publication=await publishUserRequestedSourceLookupDelta({db:h.adapter,worldStore:h.worlds,sourceStore:sources,
  sha256Hex:sha.sha256Hex,worldId:'w',branchId:h.branchId,stateVersion:0,baseRevision:1,
  sourceSha256:pkg.manifest.sourceSha256,book:'player_handbook',
  passages:[{chapterId:'ch',chapterTitle:'开篇',startCodePoint:0,endCodePoint:20,text:await sources.readRange('src',0,20)}],
  existingEntryIds:new Set(pkg.entries.map(e=>e.entryId)),createdAt:'2026-10-09T07:00:00Z'});
 assert.equal(publication.status,'published',JSON.stringify(publication.publication?.delta.validation.errors));
 assert.equal(h.db.prepare('select snapshot_json from snapshots where branch_id=? and state_version=0').get(h.branchId).snapshot_json,before,'publication never rewrites the historical game snapshot');
 await h.session.playTurn({campaignId:h.campaignId,branchId:h.branchId,intent:'向林凡打听青石巷最近的情况'});
 const point=await h.turns.getState(h.branchId);
 const sourceGenerations=h.db.prepare('select state_version,content_version,manifest_hash from branch_content_manifests where branch_id=? and state_version<=? order by state_version,content_version').all(h.branchId,point.stateVersion);
 assert.ok(sourceGenerations.filter(r=>r.state_version===0).length>=2,'the regression has multiple content generations at one game version');
 const result=await forkBranch({db:h.adapter,turnStore:h.turns,gameStore:new SqliteGameStore(h.adapter),sourceBranchId:h.branchId,
  targetBranchId:h.branchId+'-generation',campaignId:h.campaignId,forkTurnId:'turn-0001',createdAt:'2026-10-09T07:01:00Z'});
 assert.deepEqual(h.db.prepare('select state_version,content_version,manifest_hash from branch_content_manifests where branch_id=? order by state_version,content_version').all(result.snapshot.branchId),sourceGenerations);
 const saved=await exportSave({db:h.adapter,sha256Hex:sha.sha256Hex,campaignId:h.campaignId,branchId:result.snapshot.branchId,createdAt:'2026-10-09T07:02:00Z'});
 assert.equal((await validateSaveJson(saved.json,sha.sha256Hex)).ok,true);
});
