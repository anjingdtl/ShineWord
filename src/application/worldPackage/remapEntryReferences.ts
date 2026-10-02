import type { ContentEntry } from '../../domain/content/types';

/** Exact immutable-entry identifiers only. Text and source entity IDs retain
 * their original spelling; nested scene/card/item references use new versions. */
export function remapEntryReferences(entry: ContentEntry, ids: ReadonlyMap<string, string>): ContentEntry {
  const visit = (value: unknown): unknown => {
    if (typeof value === 'string') return ids.get(value) ?? value;
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [ids.get(key) ?? key, visit(child)]));
    return value;
  };
  return { ...entry, entryId: ids.get(entry.entryId) ?? entry.entryId,
    dependencyIds: entry.dependencyIds.map(id => ids.get(id) ?? id),
    definition: visit(entry.definition) as ContentEntry['definition'] };
}
