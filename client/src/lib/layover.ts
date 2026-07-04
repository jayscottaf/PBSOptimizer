// Helpers for working with pairing layover durations.
//
// Layover durations are stored as HOURS.MINUTES strings (e.g. "18.48" =
// 18h48m), the same convention as credit/block/TAFB — NOT decimal hours.

/** Parse an "HH.MM" layover duration string to total minutes. */
export function layoverDurationToMinutes(duration: unknown): number {
  const str = String(duration ?? '').trim();
  if (!str) return 0;
  const [h, m] = str.split('.');
  const hours = parseInt(h || '0', 10) || 0;
  const minutes = parseInt((m || '0').padEnd(2, '0').slice(0, 2), 10) || 0;
  return hours * 60 + minutes;
}

/** Longest single layover in a pairing, in minutes (0 if it has none). */
export function maxLayoverMinutes(pairing: any): number {
  const layovers = Array.isArray(pairing?.layovers) ? pairing.layovers : [];
  let max = 0;
  for (const l of layovers) {
    const mins = layoverDurationToMinutes(l?.duration);
    if (mins > max) max = mins;
  }
  return max;
}

/** Compact "18h 48m" label; "—" when there is no layover (e.g. a turn). */
export function formatLayoverMinutes(mins: number): string {
  if (!mins || mins <= 0) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h`;
}
