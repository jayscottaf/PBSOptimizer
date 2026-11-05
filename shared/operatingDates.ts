/**
 * A pairing's concrete departure dates within a bid period.
 *
 * Expands what the package prints — an effective range, the weekdays the
 * trip flies (`operatingDows`, already resolved by ./operatingDays) and the
 * dates it skips (`exceptDates`) — into the exact dates it departs. Every
 * consumer (simulator, line constructor, stats, Prefer Off filtering,
 * calendar conflicts, Add to Calendar) goes through this one function, so
 * they cannot disagree about when a trip operates.
 */

import { parseMonthDayToken } from './operatingDays';

const MS_PER_DAY = 86_400_000;
/** A range is at most a bid period plus carry-over; cap defensively. */
const MAX_INSTANCES = 62;

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};
const DOW_CODES: Record<string, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};
const MONTH_DAY = /(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\.?\s*(\d{1,2})/g;

export interface OperatingDateFacts {
  /** Range as stored, e.g. "AUG11-AUG. 29" or "JAN10 ONLY". */
  effectiveDates?: string | null;
  /** Weekdays the trip may start on (0=Sun..6=Sat); null = unrestricted. */
  operatingDows?: number[] | null;
  /** Skipped dates as stored, e.g. ["AUG 13", "AUG 15"]. */
  exceptDates?: string[] | null;
}

/** The bid period the range belongs to (month 1-12). */
export interface BidPeriodAnchor {
  month: number;
  year: number;
}

/** "July", "JUL", "jul 2026" -> 7; null when unrecognized. */
export function periodMonthNumber(name: unknown): number | null {
  const key = String(name ?? '').trim().slice(0, 3).toUpperCase();
  return MONTHS[key] ?? null;
}

/** UTC epoch day for a calendar date (avoids time-zone drift). */
export function epochDay(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/** 0=Sunday .. 6=Saturday for an epoch day. 1970-01-01 was a Thursday. */
export function dowOfEpochDay(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

/** Epoch day -> "YYYY-MM-DD". */
export function isoOfEpochDay(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * Departure dates as UTC epoch days, ascending.
 *
 * Month/day tokens are anchored to the period year, shifting across the year
 * boundary when a token month is far from the period month (a DEC token in a
 * JAN package is the previous year, a JAN token in a DEC package the next).
 */
export function expandOperatingDays(
  facts: OperatingDateFacts,
  period: BidPeriodAnchor
): number[] {
  const text = String(facts.effectiveDates ?? '').toUpperCase();
  // Older rows stored "AUG11-AUG. 29 EXCEPT AUG 13": only text before the
  // first EXCEPT/EXCPT is the range, or the last exception becomes its end.
  const [rangeText, ...exceptParts] = text.split(/\bEXCE?PT\b/);
  const tokens = [...rangeText.matchAll(MONTH_DAY)].map(m => ({
    month: MONTHS[m[1]],
    day: parseInt(m[2], 10),
  }));
  if (tokens.length === 0) return [];

  const anchor = (t: { month: number; day: number }): number => {
    let year = period.year;
    const diff = t.month - period.month;
    if (diff > 6) year -= 1;
    if (diff < -6) year += 1;
    return epochDay(year, t.month, t.day);
  };
  const first = anchor(tokens[0]);
  const last = Math.max(first, anchor(tokens[tokens.length - 1]));

  let allowed: Set<number> | null =
    Array.isArray(facts.operatingDows) && facts.operatingDows.length > 0
      ? new Set(facts.operatingDows)
      : null;
  const skipped = new Set<number>();
  for (const token of facts.exceptDates ?? []) {
    const md = parseMonthDayToken(token);
    if (md) skipped.add(anchor(md));
  }
  // Legacy text form: weekday codes and dates inside an EXCEPT clause of the
  // stored range. Stored operatingDows, when present, already account for
  // the weekday part.
  const exceptText = exceptParts.join(' ');
  if (!allowed) {
    const banned = new Set(
      (exceptText.match(/\b(SU|MO|TU|WE|TH|FR|SA)\b/g) ?? []).map(
        code => DOW_CODES[code]
      )
    );
    if (banned.size > 0) {
      allowed = new Set([0, 1, 2, 3, 4, 5, 6].filter(d => !banned.has(d)));
    }
  }
  for (const m of exceptText.matchAll(MONTH_DAY)) {
    skipped.add(anchor({ month: MONTHS[m[1]], day: parseInt(m[2], 10) }));
  }

  const build = (applyWeekdays: boolean): number[] => {
    const out: number[] = [];
    for (let d = first; d <= last && out.length < MAX_INSTANCES; d++) {
      if (applyWeekdays && allowed && !allowed.has(dowOfEpochDay(d))) continue;
      if (skipped.has(d)) continue;
      out.push(d);
    }
    return out;
  };
  const filtered = build(true);
  // A bad year anchor must not silently delete a pairing: if the weekday
  // filter leaves nothing, the anchor and the printed weekdays disagree, so
  // trust the range.
  return filtered.length > 0 ? filtered : build(false);
}

/** Departure dates as "YYYY-MM-DD", ascending. */
export function expandOperatingDates(
  facts: OperatingDateFacts,
  period: BidPeriodAnchor
): string[] {
  return expandOperatingDays(facts, period).map(isoOfEpochDay);
}
