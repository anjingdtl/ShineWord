'use strict';
const { createMobileHarness, sha } = require('./mobileHarness.cjs');
const load = name => require('../../dist/' + name);
async function createPhase6MobileHarness(options) {
  const h = await createMobileHarness(options), r = h.runtime;
  r.sourceStore = new (load('infra/sqlite/sqliteSourceStore').SqliteSourceStore)(h.adapter);
  r.sourceCatalog = new (load('application/sourceIndex/sourceCatalog').SourceCatalogAdapter)(r.sourceStore,r.worldStore,sha);
  r.sourceIndexStore = new (load('infra/sqlite/sqliteSourceIndexStore').SqliteSourceIndexStore)(h.adapter);
  r.sourceIndex = new (load('application/sourceIndex/persistentSourceSearch').PersistentSourceSearchService)(r.sourceCatalog,r.sourceStore,r.worldStore,r.sourceIndexStore,sha);
  r.segmentPlans = new (load('infra/sqlite/sqliteSegmentPlanStore').SqliteSegmentPlanStore)(h.adapter);
  r.segmentConfigs = new (load('infra/sqlite/sqliteSegmentExecutionConfigStore').SqliteSegmentExecutionConfigStore)(h.adapter,sha);
  r.openingSurveys = new (load('infra/sqlite/sqliteOpeningSurveyStore').SqliteOpeningSurveyStore)(h.adapter);
  r.segmentArtifacts = new (load('infra/sqlite/sqliteSegmentArtifactStore').SqliteSegmentArtifactStore)(h.adapter,sha.sha256Hex);
  r.segmentPublication = new (load('application/segmentPublication/service').SegmentPublicationService)({store:r.segmentArtifacts,worldStore:r.worldStore,sourceCatalog:r.sourceCatalog,sha256Hex:sha.sha256Hex});
  const executor = new (load('application/segmentBuild/existingBuildExecutor').ExistingBuildExecutor)({sources:r.sourceStore,worlds:r.worldStore,runs:h.runStore,catalog:r.sourceCatalog,config:(w,f)=>r.segmentConfigs.get(w,f),sha256Hex:sha.sha256Hex,
    control:async(id,command)=>h.runStore.requestRunControl(id,command,new Date().toISOString())});
  r.segments = new (load('application/segmentBuild/segmentBuildService').SegmentBuildService)({store:r.segmentPlans,catalog:r.sourceCatalog,executor,artifacts:r.segmentPublication,sha256Hex:sha.sha256Hex});
  return h;
}
module.exports = { createPhase6MobileHarness };
