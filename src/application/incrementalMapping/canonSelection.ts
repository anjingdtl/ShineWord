import type { CanonDeltaV1, OpeningRequirementsV1, SourceRangeV1, SourceSetBindingV1 } from '../../domain/build/phase6';
import type { ContentEntry } from '../../domain/content/types';
import type { StoredEntity, StoredEvent, StoredFact } from '../ports/worldStore';
import { PLAYABILITY_MIN_FACTS } from '../worldPackage/playabilityGate';

export const CANON_SELECTION_VERSION = 'canon-selection-1';
export interface IncrementalMappingOptions {
  kind: 'opening' | 'incremental';
  ranges: readonly SourceRangeV1[];
  sourceBinding: SourceSetBindingV1;
  executionConfigFingerprint: string;
  requirements?: OpeningRequirementsV1;
  delta?: CanonDeltaV1;
  /** Previously published immutable content; cloned before merge. */
  previousEntries?: readonly ContentEntry[];
}
export interface SelectedCanon {
  facts: StoredFact[];
  entities: StoredEntity[];
  events: StoredEvent[];
  affectedEntryIds: string[];
  diagnostics: string[];
}

/** Resolve the already persisted s{N}- mirror identity, never global offsets. */
export function sourceIdForChapter(chapterId: string, binding: SourceSetBindingV1): string | null {
  const prefix = /^s([2-9]|[1-9]\d+)-/.exec(chapterId);
  const ordinal = prefix ? Number(prefix[1]) : 1;
  return binding.members.find(member => member.sourceOrdinal === ordinal)?.sourceId ?? null;
}

export function factCoveredByRanges(fact: StoredFact, options: Pick<IncrementalMappingOptions, 'ranges' | 'sourceBinding'>): boolean {
  // Branch fiction, synthetic records and unlocated evidence are not reusable canon.
  return (fact.scope === 'world' || fact.scope === 'canon') && fact.sources.length > 0 && fact.sources.every(span => {
    const sourceId = sourceIdForChapter(span.chapterId, options.sourceBinding);
    return options.ranges.some(range => range.sourceId === sourceId
      && options.sourceBinding.members.some(member => member.sourceId === sourceId
        && member.normalizedTreeHash === range.normalizedTreeHash)
      && span.startOffset >= range.startCp && span.endOffset <= range.endCp);
  });
}

function valueStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(valueStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(valueStrings);
  return [];
}

/** Deterministic bounded input: changed facts plus evidence/reference closure. */
export function selectCanonSubset(input: {
  facts: readonly StoredFact[]; entities: readonly StoredEntity[]; events: readonly StoredEvent[];
  options: IncrementalMappingOptions;
}): SelectedCanon {
  const { options } = input;
  const diagnostics: string[] = [];
  if (!options.executionConfigFingerprint.trim() || options.ranges.length === 0) {
    diagnostics.push('范围或冻结执行配置缺失');
  }
  const eligible = input.facts.filter(fact => factCoveredByRanges(fact, options));
  const good = eligible.filter(fact => fact.status === 'explicit' || fact.status === 'inference');
  const byFact = new Map(good.map(fact => [fact.factId, fact]));
  const byEntity = new Map(input.entities.map(entity => [entity.entityId, entity]));
  const byEvent = new Map(input.events.filter(event => event.status === 'canon').map(event => [event.eventId, event]));
  const chosenFacts = new Set<string>();
  const chosenEntities = new Set<string>();
  const chosenEvents = new Set<string>();
  const affectedEntries = new Set<string>();
  const requirements = options.requirements;
  const addFact = (id: string): void => {
    const fact = byFact.get(id);
    if (!fact) { diagnostics.push(`必需事实缺失、无证据或超出授权范围：${id}`); return; }
    chosenFacts.add(id);
    chosenEntities.add(fact.subjectEntityId);
  };
  for (const id of requirements?.requiredFactIds ?? []) addFact(id);
  for (const id of requirements?.requiredEntityIds ?? []) chosenEntities.add(id);
  for (const id of requirements?.requiredEventIds ?? []) chosenEvents.add(id);
  if (options.kind === 'incremental') {
    for (const id of options.delta?.factIds ?? good.map(fact => fact.factId)) addFact(id);
    for (const id of options.delta?.entityIds ?? []) chosenEntities.add(id);
    for (const id of options.delta?.eventIds ?? []) chosenEvents.add(id);
    // An old entry touched by new evidence pulls in only its existing evidence,
    // then reverse dependencies; unrelated old entries never reach the model.
    const changedFacts = new Set(options.delta?.factIds ?? chosenFacts);
    const changedEntities = new Set([...(options.delta?.entityIds ?? []),
      ...good.filter(f => changedFacts.has(f.factId)).map(f => f.subjectEntityId)]);
    const allByFact = new Map(input.facts.map(f => [f.factId, f]));
    for (const entry of options.previousEntries ?? []) {
      if (entry.provenance.sourceFactIds.some(id => changedFacts.has(id))
        || entry.provenance.sourceFactIds.some(id => changedEntities.has(allByFact.get(id)?.subjectEntityId ?? ''))
        || Object.values(entry.fieldProvenance ?? {}).some(p => p.sourceFactIds.some(id => changedFacts.has(id)))
        || valueStrings(entry.definition).some(value => changedEntities.has(value)
          || input.entities.some(e => changedEntities.has(e.entityId) && (e.name === value || e.aliases.includes(value))))) affectedEntries.add(entry.entryId);
    }
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const entry of options.previousEntries ?? []) {
        if (entry.dependencyIds.some(id => affectedEntries.has(id)) && !affectedEntries.has(entry.entryId)) {
          affectedEntries.add(entry.entryId); expanded = true;
        }
      }
    }
    for (const entry of options.previousEntries ?? []) if (affectedEntries.has(entry.entryId)) {
      for (const id of entry.provenance.sourceFactIds) {
        // Published evidence may be outside the new ranges. Keep it as immutable
        // dependency content; do not send future/global old canon as context.
        if (byFact.has(id)) addFact(id);
      }
    }
  } else {
    for (const type of ['character', 'location'] as const) {
      const entity = input.entities.find(e => e.type === type && good.some(f => f.subjectEntityId === e.entityId));
      if (entity) chosenEntities.add(entity.entityId);
      else diagnostics.push(`开局缺少带来源依据的${type === 'character' ? '人物' : '地点'}`);
    }
    const coveredChapters = new Set(good.flatMap(f => f.sources.map(s => s.chapterId)));
    const event = input.events.find(e => e.status === 'canon' && e.narrativeChapterId && coveredChapters.has(e.narrativeChapterId));
    if (event) chosenEvents.add(event.eventId);
    else diagnostics.push('开局缺少已解析且带场景来源的事件');
    // Retain the old 20-fact gate; prioritize selected people/places, then fill
    // with evidenced facts, rather than lowering the quality requirement.
    const ordered = [...good.filter(f => chosenEntities.has(f.subjectEntityId)), ...good];
    for (const fact of ordered) {
      if (chosenFacts.size >= PLAYABILITY_MIN_FACTS) break;
      addFact(fact.factId);
    }
  }
  let expanded = true;
  while (expanded) {
    const before = chosenFacts.size + chosenEntities.size + chosenEvents.size;
    for (const id of [...chosenEntities]) {
      if (!byEntity.has(id)) { diagnostics.push(`引用实体缺失：${id}`); continue; }
      if (![...chosenFacts].some(f => byFact.get(f)?.subjectEntityId === id)) {
        const support = good.find(f => f.subjectEntityId === id);
        if (support) addFact(support.factId);
        else diagnostics.push(`实体缺少授权范围内的事实依据：${id}`);
      }
    }
    for (const id of [...chosenFacts]) {
      const fact = byFact.get(id)!;
      for (const value of valueStrings(fact.value)) {
        const entity = byEntity.get(value) ?? input.entities.find(e => e.name === value || e.aliases.includes(value));
        if (entity) chosenEntities.add(entity.entityId);
        else if (/^(entity-|ent-)/.test(value)) diagnostics.push(`事实引用实体缺失：${value}`);
      }
    }
    for (const id of [...chosenEvents]) {
      const event = byEvent.get(id);
      if (!event) { diagnostics.push(`必需事件依赖缺失：${id}`); continue; }
      if (!event.narrativeChapterId || !good.some(f => f.sources.some(s => s.chapterId === event.narrativeChapterId))) {
        diagnostics.push(`事件缺少授权范围内的来源闭包：${id}`);
      }
      for (const dep of event.dependsOnEventIds) chosenEvents.add(dep);
      for (const entity of input.entities) if (entity.name.length >= 2
        && (event.title.includes(entity.name) || event.summary.includes(entity.name))) chosenEntities.add(entity.entityId);
    }
    expanded = before !== chosenFacts.size + chosenEntities.size + chosenEvents.size;
  }
  const facts = good.filter(f => chosenFacts.has(f.factId));
  if (options.kind === 'opening' && facts.length < PLAYABILITY_MIN_FACTS) diagnostics.push(`Canon 事实不足（${facts.length}/${PLAYABILITY_MIN_FACTS}）`);
  const selectedSubjects = new Set(facts.map(f => f.subjectEntityId));
  for (const conflict of eligible.filter(f => f.status === 'conflict')) if (selectedSubjects.has(conflict.subjectEntityId)
    || requirements?.requiredFactIds.includes(conflict.factId)) diagnostics.push(`依赖闭包存在冲突事实：${conflict.factId}`);
  // Required actions must refer to existing, closed content. Missing actions
  // are blockers, never replaced by a fabricated generic action.
  const entriesById = new Map((options.previousEntries ?? []).map(e => [e.entryId, e]));
  const inspectEntry = (id: string, seen = new Set<string>()): void => {
    if (seen.has(id)) return; seen.add(id);
    const entry = entriesById.get(id);
    if (!entry) { diagnostics.push(`行动入口或条目依赖缺失：${id}`); return; }
    for (const dep of entry.dependencyIds) inspectEntry(dep, seen);
  };
  for (const id of requirements?.requiredEntryIds ?? []) inspectEntry(id);
  return { facts, entities: input.entities.filter(e => chosenEntities.has(e.entityId)),
    events: input.events.filter(e => chosenEvents.has(e.eventId)), affectedEntryIds: [...affectedEntries],
    diagnostics: [...new Set(diagnostics)] };
}

/** Preserve immutable old definitions; emit a new revision for affected IDs. */
export function mergeIncrementalEntries(previous: readonly ContentEntry[], mapped: readonly ContentEntry[], affectedIds: readonly string[]): ContentEntry[] {
  const affected = new Set(affectedIds);
  // ContentEntry is a validated JSON protocol, compatible with RN Hermes
  // without depending on structuredClone availability.
  const clone = (entry: ContentEntry): ContentEntry => JSON.parse(JSON.stringify(entry)) as ContentEntry;
  const result = new Map(previous.map(entry => [entry.entryId, clone(entry)]));
  for (const entry of mapped) {
    const old = result.get(entry.entryId);
    if (old && !affected.has(entry.entryId)) continue;
    result.set(entry.entryId, clone(entry));
  }
  // Every old dependency remains referenced by its prior immutable definition.
  for (const entry of result.values()) for (const id of entry.dependencyIds) if (!result.has(id)) {
    throw new Error(`增量映射引用闭包缺失：${entry.entryId} -> ${id}`);
  }
  return [...result.values()];
}
