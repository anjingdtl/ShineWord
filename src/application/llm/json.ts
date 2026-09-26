export function parseStrictJsonObject<T>(text: string, label: string): T {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    throw new Error(`${label} must be a single JSON object without prose wrappers.`);
  }
  try {
    const value = JSON.parse(trimmed) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${label} must be a JSON object.`);
    }
    return value as T;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${label} contains invalid JSON.`);
    }
    throw error;
  }
}
