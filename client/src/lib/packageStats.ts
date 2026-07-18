import { maxLayoverMinutes } from '@/lib/layover';

/** Pure KPI calculations over the client-side pairing list. */

interface PairingLike {
  holdProbability?: number | string | null;
  creditHours?: number | string | null;
  layovers?: unknown;
  [key: string]: unknown;
}

export function countLikelyToHold(
  pairings: PairingLike[],
  minPct = 70
): number {
  return pairings.filter(
    p => Number(p.holdProbability ?? 0) >= minPct
  ).length;
}

/** Delta HH.MM strings ("18.30" = 18h30m) — compare on the raw number,
 *  which preserves ordering for valid minute values (< .60). */
export function countHighCredit(
  pairings: PairingLike[],
  minCredit = 18
): number {
  return pairings.filter(
    p => parseFloat(String(p.creditHours ?? '0')) >= minCredit
  ).length;
}

export function countLongLayover(
  pairings: PairingLike[],
  minHours = 20
): number {
  const minMinutes = minHours * 60;
  return pairings.filter(p => maxLayoverMinutes(p) >= minMinutes).length;
}

export function pct(part: number, total: number): string {
  if (!total) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}
