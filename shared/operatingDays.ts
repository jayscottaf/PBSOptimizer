/**
 * A pairing's real operating days.
 *
 * A bid-package header does not just carry a date range — it carries which
 * weekdays the trip actually flies, and a separate list of dates it skips:
 *
 *   #A227  TU TH SA        EFFECTIVE AUG11-AUG. 29   CHECK-IN AT 20.59
 *                  EXCEPT AUG 13 AUG 15 AUG 20 AUG 22
 *
 * That trip operates on five dates (Aug 11, 18, 25, 27, 29), not the
 * nineteen days its range spans. Two dialects appear in real packages:
 *
 *   "TU TH SA"        -> operates ONLY those weekdays  (positive)
 *   "EXCPT FR SA SU"  -> operates every weekday EXCEPT those  (negative)
 *
 * Note the deliberate near-collision in Delta's own text: `EXCPT` (no
 * second E) introduces WEEKDAYS on the header line, while `EXCEPT`
 * introduces DATES on a continuation line — and a single pairing can carry
 * both. Parsing them apart is the whole job of this module.
 *
 * Shared so the parser, the simulator, the backfill script and the client
 * all resolve operating days identically.
 */

/** Two-letter codes as printed, mapped to JS day numbers (0=Sun..6=Sat). */
const DOW_CODES: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

export const ALL_DOWS = [0, 1, 2, 3, 4, 5, 6];

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

export interface OperatingDays {
  /**
   * Weekdays the trip may START on (0=Sun..6=Sat), already resolved from
   * whichever dialect the package used. `null` means unrestricted — the
   * header named no weekdays, so no filtering should be applied.
   */
  operatingDows: number[] | null;
  /** Dates the trip skips, normalized to "MMM DD" (e.g. "AUG 13"). */
  exceptDates: string[];
}

/**
 * Pull the weekday clause out of a pairing header line.
 *
 * The clause sits between the pairing number and `EFFECTIVE`, so anchoring
 * on both ends keeps flight rows and airport codes from matching. Returns
 * null when the header names no weekdays (trip runs any day in its range).
 */
export function parseOperatingDows(headerLine: string): number[] | null {
  const text = String(headerLine ?? '').toUpperCase();
  // Everything between "#<number>" and "EFFECTIVE" — the only region where a
  // weekday clause can legally appear.
  const between = text.match(/^#[A-Z]?\d{3,5}\s+(.*?)\bEFFECTIVE\b/);
  if (!between) {
    return null;
  }
  const clause = between[1];
  const negated = /\bEXCPT\b/.test(clause);
  const codes = (clause.match(/\b(SU|MO|TU|WE|TH|FR|SA)\b/g) ?? []).map(
    c => DOW_CODES[c]
  );
  const unique = [...new Set(codes)].sort((a, b) => a - b);
  if (unique.length === 0) {
    return null;
  }
  if (negated) {
    const banned = new Set(unique);
    return ALL_DOWS.filter(d => !banned.has(d));
  }
  return unique;
}

/**
 * Pull the skipped dates out of a whole pairing block.
 *
 * Must not confuse `EXCPT <weekdays>` with `EXCEPT <dates>`: the negative
 * lookahead on a month token is what separates them, since only the date
 * form is followed by "AUG 13"-style tokens.
 */
export function parseExceptDates(block: string): string[] {
  const text = String(block ?? '').toUpperCase();
  const out: string[] = [];
  // Match each "EXCEPT" run and take the month/day tokens that follow it.
  const re = /\bEXCEPT\b((?:\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\.?\s*\d{1,2})+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tokens =
      m[1].match(
        /(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\.?\s*(\d{1,2})/g
      ) ?? [];
    for (const t of tokens) {
      const parts = t.match(
        /(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\.?\s*(\d{1,2})/
      );
      if (parts) {
        out.push(`${parts[1]} ${String(parseInt(parts[2], 10)).padStart(2, '0')}`);
      }
    }
  }
  return [...new Set(out)];
}

/**
 * Extract the effective range as printed, e.g. "AUG11-AUG. 29" or
 * "JAN10 ONLY". Scans the WHOLE block including the header line, because
 * `EFFECTIVE` normally lives on the header — a scan starting at line 1
 * misses it entirely and falls back to guessing the month.
 */
export function parseEffectiveRangeText(block: string): string {
  for (const raw of String(block ?? '').split('\n')) {
    const line = raw.trim();
    const idx = line.toUpperCase().indexOf('EFFECTIVE');
    if (idx === -1) {
      continue;
    }
    let tail = line.substring(idx + 'EFFECTIVE'.length).trim();
    // Stop before the check-in clause or the flight table header.
    tail = tail.split(/CHECK-?IN|DAY\s+FLIGHT|DAY\s+[A-Z]\b/i)[0].trim();
    // "EXCEPT" dates are a separate concept; never let them leak into the
    // range, or the last exception silently becomes the range end.
    tail = tail.split(/\bEXCE?PT\b/i)[0].trim();
    if (tail) {
      return tail;
    }
  }
  return '';
}

/** Both operating-day facts for a pairing block, in one call. */
export function parseOperatingDays(block: string): OperatingDays {
  const lines = String(block ?? '').split('\n');
  return {
    operatingDows: parseOperatingDows(lines[0] ?? ''),
    exceptDates: parseExceptDates(block),
  };
}

/**
 * "AUG 13" -> {month: 8, day: 13}. Returns null for anything unparseable so
 * callers can skip rather than guess.
 */
export function parseMonthDayToken(
  token: string
): { month: number; day: number } | null {
  const m = String(token ?? '')
    .toUpperCase()
    .match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\.?\s*(\d{1,2})/);
  if (!m) {
    return null;
  }
  return { month: MONTHS[m[1]], day: parseInt(m[2], 10) };
}
