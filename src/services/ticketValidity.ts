/** Event-local calendar days. Nigeria (WAT) so gate "today" matches the pass. */
export const EVENT_TZ = 'Africa/Lagos';

export function ymdInZone(date: Date, timeZone = EVENT_TZ): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function todayYmd(): string {
  return ymdInZone(new Date());
}

/** Store a YYYY-MM-DD as noon WAT so it does not slip a day in UTC. */
export function parseValidOn(raw: unknown): Date | null {
  if (raw == null || raw === '' || raw === 'all') return null;
  const s = String(raw).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(`${s}T12:00:00+01:00`);
}

export function formatDayLong(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00+01:00`);
  return d.toLocaleDateString('en-NG', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });
}

export function isMultiDayEvent(start: Date, end: Date): boolean {
  return ymdInZone(start) !== ymdInZone(end);
}
