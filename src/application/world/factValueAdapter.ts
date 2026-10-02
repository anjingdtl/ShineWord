/** Closed protocol adaptation of model values. It never derives a claim
 * from quote text; empty/unsupported values retain the legacy quote record. */
export function normalizeFactValue(predicate: string, value: unknown, quote: string): Record<string, unknown> {
  if (typeof value === 'string' && value.trim()) return {
    [predicate === 'current_location' || predicate === 'home_location' ? 'location' : predicate === 'role' ? 'position' : 'text']: value.trim(),
  };
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const wrapped = record[predicate];
    if (Object.keys(record).length === 1 && wrapped && typeof wrapped === 'object' && !Array.isArray(wrapped)) {
      const atomic = wrapped as Record<string, unknown>;
      if ((predicate === 'current_location' || predicate === 'home_location') && typeof atomic.location === 'string') return { location: atomic.location };
      if (predicate === 'role' && typeof atomic.position === 'string') return { position: atomic.position };
    }
    if (Object.keys(record).length) return record;
  }
  return { text: quote };
}
