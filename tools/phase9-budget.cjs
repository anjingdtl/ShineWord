/** Shared, persistent physical-dispatch cap for private Phase 9 QA drivers. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Deliberately points at the required original 1291/1500 manifest. The old
// .tmp/phase9/test-manifest.json (1210) is diagnostic history, never authority.
const manifestPath = path.resolve(__dirname, '../.tmp/phase9/local-20261009/test-manifest.json');
const HARD_STOP = 1450;
const SCOPED_SCHEMA = 'shineword.phase9.scoped-budget/v1';
const FILE_REPLACE_RETRY_COUNT = 1200;
const FILE_REPLACE_RETRY_MS = 25;

function renameWithRetry(sourcePath, targetPath) {
  for (let attempt = 0; attempt < FILE_REPLACE_RETRY_COUNT; attempt++) {
    try { fs.renameSync(sourcePath, targetPath); return; }
    catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt === FILE_REPLACE_RETRY_COUNT - 1) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, FILE_REPLACE_RETRY_MS);
    }
  }
}

function readManifestSnapshot(filePath = manifestPath) {
  const resolvedPath = path.resolve(filePath);
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(resolvedPath, 'utf8')); }
  catch { throw new Error('Phase 9 authoritative manifest unavailable or invalid; refusing dispatch.'); }
  const budget = manifest?.budget;
  if (!Number.isInteger(budget?.spent) || !Number.isInteger(budget?.totalPhysicalRequests)
    || budget.spent < 1291 || budget.totalPhysicalRequests !== 1500 || budget.spent > HARD_STOP
    || (budget.contractBaseSpent !== undefined && budget.contractBaseSpent !== 1291)
    || (budget.spent !== 1291 && budget.contractBaseSpent !== 1291)
    || (budget.hardStop !== undefined && budget.hardStop !== HARD_STOP)) {
    throw new Error('Phase 9 authoritative budget does not match the 1500-request contract or 1450 hard stop.');
  }
  return manifest;
}

function createPhysicalBudget({ filePath = manifestPath, now = () => new Date().toISOString(), id = () => crypto.randomUUID() } = {}) {
  const resolvedPath = path.resolve(filePath);
  function updateManifest(update) {
    const lockPath = `${resolvedPath}.lock`;
    let lock;
    for (let i = 0; i < 1200; i++) {
      try { lock = fs.openSync(lockPath, 'wx'); break; }
      catch (error) {
        if (error.code !== 'EEXIST') throw new Error('Phase 9 authoritative manifest unavailable; refusing dispatch.');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      }
    }
    if (lock === undefined) throw new Error('Phase 9 manifest lock unavailable; refusing dispatch.');
    try {
      const manifest = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
      update(manifest);
      const temporary = `${resolvedPath}.${process.pid}.${id()}.tmp`;
      try {
        fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2), { encoding: 'utf8', mode: 0o600 });
        renameWithRetry(temporary, resolvedPath);
      } catch (error) {
        try { fs.unlinkSync(temporary); } catch { /* preserve the primary failure */ }
        throw error;
      }
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error('Phase 9 authoritative manifest is invalid; refusing dispatch.');
      throw error;
    } finally {
      fs.closeSync(lock);
      try { fs.unlinkSync(lockPath); } catch { /* retain the primary result */ }
    }
  }

  function reservePhysicalRequest(input) {
    const meta = typeof input === 'string' ? { owner: input } : (input ?? {});
    const owner = String(meta.owner ?? '').trim();
    const requestKind = String(meta.requestKind ?? 'unknown').trim();
    if (!owner || owner.length > 80 || /[\r\n]/.test(owner)) throw new Error('Invalid Phase 9 dispatch owner.');
    const reservationId = `p9-${id()}`;
    updateManifest(manifest => {
      const budget = manifest?.budget;
      if (!Number.isInteger(budget?.spent) || !Number.isInteger(budget?.totalPhysicalRequests)
        || budget.spent < 1291 || budget.totalPhysicalRequests !== 1500 || budget.spent > HARD_STOP
        || (budget.contractBaseSpent !== undefined && budget.contractBaseSpent !== 1291)
        || (budget.spent !== 1291 && budget.contractBaseSpent !== 1291)
        || (budget.hardStop !== undefined && budget.hardStop !== HARD_STOP)) {
        throw new Error('Invalid Phase 9 authoritative budget manifest; refusing dispatch.');
      }
      if (budget.contractBaseSpent === undefined) {
        budget.contractBaseSpent = 1291;
        budget.hardStop = HARD_STOP;
        budget.checkpointAt = HARD_STOP;
      }
      if (!Array.isArray(budget.physicalDispatchAudit)) budget.physicalDispatchAudit = [];
      if (meta.attemptId && budget.physicalDispatchAudit.some(row => row.attemptId === meta.attemptId)) {
        throw new Error('This durable LLM attempt already has a physical dispatch reservation.');
      }
      const unresolved = budget.physicalDispatchAudit.filter(row => row.status === 'reserved').length;
      if (budget.spent + unresolved >= HARD_STOP) {
        throw new Error('Phase 9 1450 hard stop reached before physical dispatch.');
      }
      const reservation = {
        reservationId, owner, requestKind,
        ...(typeof meta.logicalRequestId === 'string' ? { logicalRequestId: meta.logicalRequestId } : {}),
        ...(typeof meta.attemptId === 'string' ? { attemptId: meta.attemptId } : {}),
        ...(Number.isInteger(meta.attemptNo) ? { attemptNo: meta.attemptNo } : {}),
        ...(typeof meta.campaignId === 'string' ? { campaignId: meta.campaignId } : {}),
        ...(typeof meta.branchId === 'string' ? { branchId: meta.branchId } : {}),
        ...(typeof meta.worldId === 'string' ? { worldId: meta.worldId } : {}),
        ...(Number.isInteger(meta.stateVersion) ? { stateVersion: meta.stateVersion } : {}),
        ...(typeof meta.profileFingerprint === 'string' ? { profileFingerprint: meta.profileFingerprint } : {}),
        status: 'reserved', reservedAt: now(), processId: process.pid,
      };
      budget.physicalDispatchAudit.push(reservation);
      budget.lastReservation = { reservationId, owner, requestKind, at: reservation.reservedAt };
    });
    return reservationId;
  }

  function markPhysicalRequestDispatched(reservationId) {
    updateManifest(manifest => {
      const rows = manifest.budget?.physicalDispatchAudit;
      const row = Array.isArray(rows) && rows.find(item => item.reservationId === reservationId);
      if (!row) throw new Error('Phase 9 dispatch reservation is missing.');
      if (row.status === 'sent' || row.status === 'completed' || row.status === 'outcome_unknown') return;
      if (row.status !== 'reserved') throw new Error('Phase 9 reservation cannot be dispatched from its current state.');
      if (manifest.budget.spent >= HARD_STOP) throw new Error('Phase 9 1450 hard stop reached at dispatch boundary.');
      manifest.budget.spent++;
      row.status = 'sent';
      row.sentAt = now();
    });
  }

  function finishPhysicalRequest(reservationId, result) {
    const outcome = typeof result === 'string' ? result : result?.outcome;
    if (!['completed', 'not_sent', 'outcome_unknown'].includes(outcome)) throw new Error('Invalid Phase 9 dispatch outcome.');
    updateManifest(manifest => {
      const rows = manifest.budget?.physicalDispatchAudit;
      const row = Array.isArray(rows) && rows.find(item => item.reservationId === reservationId);
      if (!row) throw new Error('Phase 9 dispatch reservation is missing.');
      if (['completed', 'not_sent', 'outcome_unknown'].includes(row.status)) return;
      if (outcome === 'not_sent') {
        if (row.status !== 'reserved') throw new Error('A dispatched physical request cannot be reconciled as not sent.');
        row.status = 'not_sent';
        row.finishedAt = now();
        return;
      }
      if (row.status === 'reserved') {
        // A response proves the reservation reached the upstream dispatch boundary.
        if (manifest.budget.spent >= HARD_STOP) throw new Error('Phase 9 1450 hard stop reached while reconciling dispatch.');
        manifest.budget.spent++;
        row.sentAt = now();
      }
      row.status = outcome;
      row.finishedAt = now();
      if (typeof result?.httpStatus === 'number' || result?.httpStatus === null) row.httpStatus = result.httpStatus;
      if (typeof result?.frameCount === 'number') row.sseFrameCount = result.frameCount;
      if (typeof result?.maxFrameGapMs === 'number' || result?.maxFrameGapMs === null) row.maxSseFrameGapMs = result.maxFrameGapMs;
      if (typeof result?.failureClass === 'string') row.failureClass = result.failureClass.slice(0, 80);
    });
  }

  return { manifestPath: resolvedPath, readManifest: () => readManifestSnapshot(resolvedPath), updateManifest,
    reservePhysicalRequest, markPhysicalRequestDispatched, finishPhysicalRequest };
}

function initializeScopedBudgetManifest({ filePath, scopeId, capPhysicalRequests, inputs = {}, now = () => new Date().toISOString() } = {}) {
  if (typeof filePath !== 'string' || !filePath.trim()) throw new Error('A scoped Phase 9 budget path is required.');
  if (typeof scopeId !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(scopeId)) throw new Error('Invalid scoped Phase 9 budget id.');
  if (!Number.isInteger(capPhysicalRequests) || capPhysicalRequests < 1 || capPhysicalRequests > 1500) {
    throw new Error('Scoped Phase 9 request cap must be between 1 and 1500.');
  }
  const resolvedPath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  let descriptor;
  try { descriptor = fs.openSync(resolvedPath, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Scoped Phase 9 budget already exists; refusing to reset or increase it.');
    throw error;
  }
  const manifest = { schema: SCOPED_SCHEMA, scopeId, createdAt: now(), capPhysicalRequests,
    spentPhysicalRequests: 0, inputs, physicalDispatchAudit: [] };
  try { fs.writeFileSync(descriptor, JSON.stringify(manifest, null, 2), 'utf8'); fs.fsyncSync(descriptor); }
  catch (error) {
    try { fs.closeSync(descriptor); } catch { /* preserve write failure */ }
    try { fs.unlinkSync(resolvedPath); } catch { /* preserve write failure */ }
    throw error;
  }
  fs.closeSync(descriptor);
  return manifest;
}

function readScopedBudgetManifest(filePath) {
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8')); }
  catch { throw new Error('Scoped Phase 9 budget unavailable or invalid; refusing dispatch.'); }
  if (manifest?.schema !== SCOPED_SCHEMA || typeof manifest.scopeId !== 'string'
    || !Number.isInteger(manifest.capPhysicalRequests) || manifest.capPhysicalRequests < 1
    || manifest.capPhysicalRequests > 1500 || !Number.isInteger(manifest.spentPhysicalRequests)
    || manifest.spentPhysicalRequests < 0 || manifest.spentPhysicalRequests > manifest.capPhysicalRequests
    || !Array.isArray(manifest.physicalDispatchAudit)) {
    throw new Error('Scoped Phase 9 budget is malformed or exceeded; refusing dispatch.');
  }
  return manifest;
}

function createScopedPhysicalBudget({ filePath, expectedCapPhysicalRequests, expectedScopeId,
  now = () => new Date().toISOString(), id = () => crypto.randomUUID() } = {}) {
  if (typeof filePath !== 'string' || !filePath.trim()) throw new Error('A scoped Phase 9 budget path is required.');
  const resolvedPath = path.resolve(filePath);
  function readCurrentManifest() {
    const manifest = readScopedBudgetManifest(resolvedPath);
    if (Number.isInteger(expectedCapPhysicalRequests) && manifest.capPhysicalRequests !== expectedCapPhysicalRequests) {
      throw new Error('Scoped Phase 9 request cap differs from its pinned launch configuration; refusing dispatch.');
    }
    if (typeof expectedScopeId === 'string' && manifest.scopeId !== expectedScopeId) {
      throw new Error('Scoped Phase 9 budget id differs from its pinned launch configuration; refusing dispatch.');
    }
    return manifest;
  }
  readCurrentManifest();
  function updateManifest(update) {
    const lockPath = `${resolvedPath}.lock`;
    let lock;
    for (let i = 0; i < 1200; i++) {
      try { lock = fs.openSync(lockPath, 'wx'); break; }
      catch (error) {
        if (error.code !== 'EEXIST') throw new Error('Scoped Phase 9 budget unavailable; refusing dispatch.');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      }
    }
    if (lock === undefined) throw new Error('Scoped Phase 9 budget lock unavailable; refusing dispatch.');
    try {
      const manifest = readCurrentManifest();
      update(manifest);
      const temporary = `${resolvedPath}.${process.pid}.${id()}.tmp`;
      try {
        fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2), { encoding: 'utf8', mode: 0o600 });
        renameWithRetry(temporary, resolvedPath);
      } catch (error) {
        try { fs.unlinkSync(temporary); } catch { /* preserve the primary failure */ }
        throw error;
      }
    } finally {
      fs.closeSync(lock);
      try { fs.unlinkSync(lockPath); } catch { /* retain the primary result */ }
    }
  }
  function reservePhysicalRequest(input) {
    const meta = typeof input === 'string' ? { owner: input } : (input ?? {});
    const owner = String(meta.owner ?? '').trim();
    const requestKind = String(meta.requestKind ?? '').trim();
    const attemptId = String(meta.attemptId ?? '').trim();
    const profileFingerprint = String(meta.profileFingerprint ?? '').trim();
    if (!owner || owner.length > 80 || /[\r\n]/.test(owner)) throw new Error('Invalid scoped Phase 9 dispatch owner.');
    if (!requestKind || requestKind.length > 80 || /[\r\n]/.test(requestKind)) throw new Error('Scoped Phase 9 dispatch request kind is required.');
    if (!attemptId || attemptId.length > 200 || /[\r\n]/.test(attemptId)) throw new Error('Scoped Phase 9 dispatch attempt identity is required.');
    if (!profileFingerprint || profileFingerprint.length > 200 || /[\r\n]/.test(profileFingerprint)) {
      throw new Error('Scoped Phase 9 model profile fingerprint is required.');
    }
    const reservationId = `p9-${id()}`;
    updateManifest(manifest => {
      const rows = manifest.physicalDispatchAudit;
      const expectedFingerprint = manifest.inputs?.profileFingerprint;
      if (typeof expectedFingerprint === 'string' && profileFingerprint !== expectedFingerprint) {
        throw new Error('Scoped Phase 9 request model profile differs from its pinned identity; refusing dispatch.');
      }
      if (rows.some(row => row.attemptId === attemptId)) throw new Error('This durable LLM attempt already has a physical dispatch reservation.');
      const unresolved = rows.filter(row => row.status === 'reserved').length;
      if (manifest.spentPhysicalRequests + unresolved >= manifest.capPhysicalRequests) {
        throw new Error(`Scoped Phase 9 ${manifest.capPhysicalRequests}-request hard cap reached before physical dispatch.`);
      }
      const reservation = { reservationId, owner, requestKind, attemptId,
        ...(typeof meta.logicalRequestId === 'string' ? { logicalRequestId: meta.logicalRequestId } : {}),
        ...(Number.isInteger(meta.attemptNo) ? { attemptNo: meta.attemptNo } : {}),
        ...(typeof meta.campaignId === 'string' ? { campaignId: meta.campaignId } : {}),
        ...(typeof meta.branchId === 'string' ? { branchId: meta.branchId } : {}),
        ...(typeof meta.worldId === 'string' ? { worldId: meta.worldId } : {}),
        ...(Number.isInteger(meta.stateVersion) ? { stateVersion: meta.stateVersion } : {}),
        profileFingerprint,
        status: 'reserved', reservedAt: now(), processId: process.pid };
      rows.push(reservation);
      manifest.lastReservation = { reservationId, owner, requestKind, at: reservation.reservedAt };
    });
    return reservationId;
  }
  function markPhysicalRequestDispatched(reservationId) {
    updateManifest(manifest => {
      const row = manifest.physicalDispatchAudit.find(item => item.reservationId === reservationId);
      if (!row) throw new Error('Scoped Phase 9 dispatch reservation is missing.');
      if (['sent', 'completed', 'outcome_unknown'].includes(row.status)) return;
      if (row.status !== 'reserved') throw new Error('Scoped Phase 9 reservation cannot be dispatched from its current state.');
      if (manifest.spentPhysicalRequests >= manifest.capPhysicalRequests) throw new Error('Scoped Phase 9 request hard cap reached at dispatch boundary.');
      manifest.spentPhysicalRequests++;
      row.status = 'sent';
      row.sentAt = now();
    });
  }
  function finishPhysicalRequest(reservationId, result) {
    const outcome = typeof result === 'string' ? result : result?.outcome;
    if (!['completed', 'not_sent', 'outcome_unknown'].includes(outcome)) throw new Error('Invalid scoped Phase 9 dispatch outcome.');
    updateManifest(manifest => {
      const row = manifest.physicalDispatchAudit.find(item => item.reservationId === reservationId);
      if (!row) throw new Error('Scoped Phase 9 dispatch reservation is missing.');
      if (['completed', 'not_sent', 'outcome_unknown'].includes(row.status)) return;
      if (outcome === 'not_sent') {
        if (row.status !== 'reserved') throw new Error('A dispatched physical request cannot be reconciled as not sent.');
        row.status = 'not_sent';
        row.finishedAt = now();
        return;
      }
      if (row.status === 'reserved') {
        if (manifest.spentPhysicalRequests >= manifest.capPhysicalRequests) throw new Error('Scoped Phase 9 request hard cap reached while reconciling dispatch.');
        manifest.spentPhysicalRequests++;
        row.sentAt = now();
      }
      row.status = outcome;
      row.finishedAt = now();
      if (typeof result?.httpStatus === 'number' || result?.httpStatus === null) row.httpStatus = result.httpStatus;
      if (typeof result?.frameCount === 'number') row.sseFrameCount = result.frameCount;
      if (typeof result?.maxFrameGapMs === 'number' || result?.maxFrameGapMs === null) row.maxSseFrameGapMs = result.maxFrameGapMs;
      if (typeof result?.failureClass === 'string') row.failureClass = result.failureClass.slice(0, 80);
    });
  }
  // Scoped run inputs and caps are frozen at initialization. Only lifecycle
  // operations may mutate this file; callers cannot rewrite spent/audit fields.
  return { manifestPath: resolvedPath, readManifest: readCurrentManifest,
    reservePhysicalRequest, markPhysicalRequestDispatched, finishPhysicalRequest };
}

const scopedPath = process.env.PHASE9_BUDGET_SCOPE_FILE;
let authority;
if (scopedPath) {
  const expectedCapPhysicalRequests = Number(process.env.PHASE9_BUDGET_SCOPE_CAP);
  const expectedScopeId = process.env.PHASE9_BUDGET_SCOPE_ID;
  if (!Number.isInteger(expectedCapPhysicalRequests) || expectedCapPhysicalRequests < 1
    || typeof expectedScopeId !== 'string' || !expectedScopeId.trim()) {
    throw new Error('Scoped Phase 9 launch must pin its request cap and budget id.');
  }
  authority = createScopedPhysicalBudget({ filePath: scopedPath, expectedCapPhysicalRequests, expectedScopeId });
} else authority = createPhysicalBudget();
module.exports = { ...authority, createPhysicalBudget, readManifestSnapshot, manifestPath, hardStop: HARD_STOP,
  initializeScopedBudgetManifest, readScopedBudgetManifest, createScopedPhysicalBudget, scopedSchema: SCOPED_SCHEMA };
