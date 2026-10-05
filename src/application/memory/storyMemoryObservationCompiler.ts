/**
 * Story observation compiler (P8-5, plan §15): the model's observation
 * protocol output is compiled against the exact committed batch evidence
 * before anything is merged. Deterministic constraints enforced locally:
 *
 *  - every accepted observation cites evidence that exists in the batch
 *    (same turns, real events) — rejected evidence writes nothing;
 *  - accepted-only derivation: summaries/counts come from accepted
 *    observations, never from rejected or ignored ones (T07);
 *  - a batch whose evidence carries deterministic known changes
 *    (relationship/quest/party/item events) must produce matching
 *    observations — an empty observation set does NOT advance a clean
 *    checkpoint (T11/A23) and triggers one bounded repair instead;
 *  - a legitimate `no_change` batch (no deterministic known changes)
 *    explicitly advances coverage (A24).
 *
 * Per-entity time is derived from the cited evidence turns, never stamped
 * with the batch end version (T09/B10).
 */

export interface ObservationEvidence {
  eventId: string;
  turnId: string;
  stateVersion: number;
  eventType: string;
  payload: Record<string, unknown>;
  publicSummary: string;
}

export interface CompiledObservation {
  kind: 'character' | 'relationship' | 'conflict' | 'thread' | 'foreshadowing' | 'objective' | 'beat';
  action: 'upsert' | 'remove' | 'open' | 'resolve' | 'update' | 'plant' | 'payoff';
  actorId?: string;
  fromActorId?: string;
  toActorId?: string;
  title?: string;
  payload: Record<string, unknown>;
  evidenceTurnIds: readonly string[];
  /** Derived from the cited evidence, not the batch end. */
  firstEvidenceStateVersion: number;
  lastEvidenceStateVersion: number;
}

export interface ObservationDiagnostic {
  code:
    | 'json_invalid'
    | 'known_change_missing'
    | 'unknown_evidence_ref'
    | 'missing_subject'
    | 'invalid_action'
    | 'future_evidence'
    | 'no_observations';
  detail: string;
}

export interface RejectedObservation {
  observation: Record<string, unknown>;
  diagnostics: ObservationDiagnostic[];
}

export interface ObservationCompileResult {
  accepted: boolean;
  /** True only when coverage may advance (accepted observations or legit no_change). */
  advanceCheckpoint: boolean;
  /** True when the model returned an explicit empty set on a quiet batch. */
  legitimateNoChange: boolean;
  acceptedObservations: CompiledObservation[];
  rejected: RejectedObservation[];
  diagnostics: ObservationDiagnostic[];
  /** Compact derived summary from ACCEPTED observations only. */
  acceptedSummary: string[];
}

const DETERMINISTIC_EVENT_PATTERNS: readonly string[] = [
  'relationship_changed',
  'quest',
  'party',
  'death',
  'join',
  'leave',
  'promise',
  'goal',
  'conflict',
];

/**
 * Deterministic known-change oracle: the committed evidence itself proves
 * that at least one semantically meaningful change happened. Derived from
 * effect/event types only — never from free text.
 */
export function hasDeterministicKnownChange(
  evidence: readonly ObservationEvidence[],
): boolean {
  for (const item of evidence) {
    if (item.eventType === 'recordEvent') {
      const nested = String(item.payload?.eventType ?? '');
      if (DETERMINISTIC_EVENT_PATTERNS.some(pattern => nested.includes(pattern))) return true;
    }
    if (['transferItem', 'grantItem', 'applyCondition', 'removeCondition'].includes(item.eventType)) {
      return true;
    }
  }
  return false;
}

function parseObservationDocument(raw: string): { document: Record<string, unknown> | null; diagnostic: ObservationDiagnostic | null } {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { document: null, diagnostic: { code: 'json_invalid', detail: 'observation document is not a JSON object' } };
    }
    return { document: parsed as Record<string, unknown>, diagnostic: null };
  } catch (error) {
    return {
      document: null,
      diagnostic: { code: 'json_invalid', detail: `observation JSON unparseable: ${error instanceof Error ? error.message : String(error)}` },
    };
  }
}

function evidenceVersionOf(
  evidence: readonly ObservationEvidence[],
  turnId: string,
): number | null {
  const match = evidence.find(item => item.turnId === turnId);
  return match ? match.stateVersion : null;
}

/**
 * Derives observation items from the patch-shaped protocol document: every
 * patch item already carries evidenceTurnIds, so the same evidence rules
 * apply without a second wire format.
 */
function deriveObservationsFromPatch(document: Record<string, unknown>): Array<Record<string, unknown>> {
  const derived: Array<Record<string, unknown>> = [];
  const pushAll = (key: string, map: (item: Record<string, unknown>) => Record<string, unknown>): void => {
    const list = document[key];
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (item && typeof item === 'object' && !Array.isArray(item)) derived.push(map(item as Record<string, unknown>));
    }
  };
  pushAll('characterUpdates', item => ({
    ...item, kind: 'character', action: 'upsert', actorId: item.actorId, evidenceTurnIds: item.evidenceTurnIds ?? [],
  }));
  pushAll('relationshipUpdates', item => ({
    ...item, kind: 'relationship', action: item.action ?? 'upsert', fromActorId: item.fromActorId, toActorId: item.toActorId,
    evidenceTurnIds: item.evidenceTurnIds ?? [],
  }));
  pushAll('conflictChanges', item => ({
    ...item, kind: 'conflict', action: item.action ?? 'open', title: item.title, evidenceTurnIds: item.evidenceTurnIds ?? [],
  }));
  pushAll('threadChanges', item => ({
    ...item, kind: 'thread', action: item.action ?? 'open', title: item.title, evidenceTurnIds: item.evidenceTurnIds ?? [],
  }));
  pushAll('foreshadowingChanges', item => ({
    ...item, kind: 'foreshadowing', action: item.action ?? 'plant', title: item.title, evidenceTurnIds: item.evidenceTurnIds ?? [],
  }));
  pushAll('completedBeats', item => ({
    ...item, kind: 'beat', action: 'upsert', title: item.summary, evidenceTurnIds: item.turnId ? [item.turnId] : [],
  }));
  const narrative = document.narrative;
  if (narrative && typeof narrative === 'object' && !Array.isArray(narrative)) {
    const narrativeRecord = narrative as Record<string, unknown>;
    if (narrativeRecord.currentObjective !== undefined || narrativeRecord.currentArc !== undefined || narrativeRecord.archiveDigestAppend !== undefined) {
      derived.push({ ...narrativeRecord, kind: 'objective', action: 'upsert', evidenceTurnIds: narrativeRecord.evidenceTurnIds ?? [] });
    }
  }
  return derived;
}

export interface CompileObservationsInput {
  branchId: string;
  evidence: readonly ObservationEvidence[];
  rawObservationText: string;
  knownChangePolicy?: { requireKnownChangeCoverage?: boolean };
}

/**
 * Compiles the raw observation protocol output. Never throws for content
 * problems — failures are returned as diagnostics so the caller can decide
 * on repair/blocked handling with the full context.
 */
export function compileObservations(input: CompileObservationsInput): ObservationCompileResult {
  const { evidence } = input;
  const result: ObservationCompileResult = {
    accepted: false,
    advanceCheckpoint: false,
    legitimateNoChange: false,
    acceptedObservations: [],
    rejected: [],
    diagnostics: [],
    acceptedSummary: [],
  };

  const { document, diagnostic } = parseObservationDocument(input.rawObservationText);
  if (!document) {
    result.diagnostics.push(diagnostic!);
    return result;
  }
  // The wire document is either an explicit observation protocol document
  // (`observations[]`) or the patch-shaped protocol whose items each carry
  // their own evidence anchors — both compile through the same validation.
  const rawList = Array.isArray(document.observations)
    ? (document.observations as unknown[])
    : deriveObservationsFromPatch(document);

  const knownChange = hasDeterministicKnownChange(evidence);
  if (rawList.length === 0) {
    if (knownChange && input.knownChangePolicy?.requireKnownChangeCoverage !== false) {
      result.diagnostics.push({
        code: 'known_change_missing',
        detail: 'batch evidence contains deterministic known changes but the observation set is empty; coverage must not advance as clean',
      });
      return result;
    }
    result.accepted = true;
    result.advanceCheckpoint = true;
    result.legitimateNoChange = true;
    result.acceptedSummary.push('no_change (empty batch: no deterministic known-change events)');
    return result;
  }

  let rejectedCount = 0;
  for (const raw of rawList) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      rejectedCount += 1;
      result.rejected.push({ observation: raw as Record<string, unknown>, diagnostics: [{ code: 'json_invalid', detail: 'observation item is not an object' }] });
      continue;
    }
    const observation = raw as Record<string, unknown>;
    const itemDiagnostics: ObservationDiagnostic[] = [];

    const kind = String(observation.kind ?? '');
    if (!['character', 'relationship', 'conflict', 'thread', 'foreshadowing', 'objective', 'beat'].includes(kind)) {
      itemDiagnostics.push({ code: 'invalid_action', detail: `unknown observation kind '${kind}'` });
    }
    const action = String(observation.action ?? 'upsert');
    if (!['upsert', 'remove', 'open', 'resolve', 'update', 'plant', 'payoff'].includes(action)) {
      itemDiagnostics.push({ code: 'invalid_action', detail: `unknown observation action '${action}'` });
    }

    const subject = observation.actorId ?? observation.fromActorId ?? observation.title;
    if (kind !== 'objective' && kind !== 'beat' && subject === undefined) {
      itemDiagnostics.push({ code: 'missing_subject', detail: `observation of kind '${kind}' names no subject` });
    }

    const evidenceTurnIds = Array.isArray(observation.evidenceTurnIds)
      ? (observation.evidenceTurnIds as unknown[]).map(id => String(id))
      : [];
    if (evidenceTurnIds.length === 0) {
      itemDiagnostics.push({ code: 'unknown_evidence_ref', detail: 'observation cites no evidence turns' });
    }
    const versions: number[] = [];
    for (const turnId of evidenceTurnIds) {
      const version = evidenceVersionOf(evidence, turnId);
      if (version === null) {
        itemDiagnostics.push({ code: 'unknown_evidence_ref', detail: `cited evidence turn '${turnId}' is not in the committed batch` });
      } else {
        versions.push(version);
      }
    }
    // Future references are impossible: the batch ends at the newest commit.
    const batchMax = evidence.reduce((max, item) => Math.max(max, item.stateVersion), 0);
    for (const version of versions) {
      if (version > batchMax) {
        itemDiagnostics.push({ code: 'future_evidence', detail: `cited evidence version ${version} is ahead of the batch` });
      }
    }

    if (itemDiagnostics.length > 0) {
      rejectedCount += 1;
      result.rejected.push({ observation, diagnostics: itemDiagnostics });
      continue;
    }

    const sorted = [...versions].sort((a, b) => a - b);
    result.acceptedObservations.push({
      kind: kind as CompiledObservation['kind'],
      action: action as CompiledObservation['action'],
      actorId: typeof observation.actorId === 'string' ? observation.actorId : undefined,
      fromActorId: typeof observation.fromActorId === 'string' ? observation.fromActorId : undefined,
      toActorId: typeof observation.toActorId === 'string' ? observation.toActorId : undefined,
      title: typeof observation.title === 'string' ? observation.title : undefined,
      payload: observation,
      evidenceTurnIds,
      firstEvidenceStateVersion: sorted[0] ?? batchMax,
      lastEvidenceStateVersion: sorted[sorted.length - 1] ?? batchMax,
    });
    result.acceptedSummary.push(
      `${kind}:${action}${typeof subject === 'string' && subject ? `:${subject}` : ''} (evidence v${sorted[0] ?? '?'}–v${sorted[sorted.length - 1] ?? '?'})`,
    );
  }

  if (rejectedCount > 0 && result.acceptedObservations.length === 0) {
    result.diagnostics.push({ code: 'no_observations', detail: 'all observations were rejected by evidence/action validation' });
    return result;
  }

  if (knownChange && result.acceptedObservations.length === 0
    && input.knownChangePolicy?.requireKnownChangeCoverage !== false) {
    result.diagnostics.push({
      code: 'known_change_missing',
      detail: 'batch evidence contains deterministic known changes but no accepted observation covers them',
    });
    return result;
  }

  if (input.knownChangePolicy?.requireKnownChangeCoverage !== false) {
    const uncovered = evidence.filter(item => hasDeterministicKnownChange([item])
      && !result.acceptedObservations.some(observation => {
        if (!observation.evidenceTurnIds.includes(item.turnId)) return false;
        const nested = item.eventType === 'recordEvent' ? item.payload : {};
        const eventType = String(nested.eventType ?? item.eventType);
        const payload = (nested.payload && typeof nested.payload === 'object' ? nested.payload : item.payload) as Record<string, unknown>;
        if (eventType.includes('relationship')) return observation.kind === 'relationship'
          && observation.fromActorId === payload.fromActorId && observation.toActorId === payload.toActorId;
        const actorId = payload.actorId ?? payload.toActorId;
        if (typeof actorId === 'string' && ['grantItem', 'transferItem', 'applyCondition', 'removeCondition'].includes(eventType)) {
          return observation.kind === 'character' && observation.actorId === actorId
            || observation.kind === 'beat' && typeof observation.payload.summary === 'string'
              && observation.payload.summary.includes(String(payload.itemId ?? payload.conditionId ?? actorId));
        }
        return true;
      }));
    if (uncovered.length > 0) {
      result.diagnostics.push({ code: 'known_change_missing',
        detail: `Accepted observations omit critical evidence turns: ${[...new Set(uncovered.map(item => item.turnId))].join(', ')}.` });
      return result;
    }
  }

  result.accepted = true;
  result.advanceCheckpoint = true;
  return result;
}
