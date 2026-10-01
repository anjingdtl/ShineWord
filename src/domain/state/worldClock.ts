/** Shared rendering of the authoritative simulation clock. */
export function worldClockParts(clockSeconds: number): { day: number; hour: number; minute: number } {
  const safe = Number.isFinite(clockSeconds) ? Math.max(0, Math.floor(clockSeconds)) : 0;
  return { day: Math.floor(safe / 86400) + 1, hour: Math.floor(safe / 3600) % 24, minute: Math.floor(safe % 3600 / 60) };
}

export function describeWorldClock(clockSeconds: number): string {
  const { day, hour, minute } = worldClockParts(clockSeconds);
  return `第${day}日 ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
