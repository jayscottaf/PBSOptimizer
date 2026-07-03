/**
 * Empirical hold probability from observed award evidence.
 *
 * Raw seniority numbers are not comparable across bid periods (hiring and
 * attrition shift the whole list), but a pilot's PERCENTILE within the
 * category roster of a given month is. Reasons Reports give us the full
 * roster of bidders per period, so every historical award can be converted
 * to "how deep into the category this trip went" — and the pilot's own
 * percentile can be compared against that distribution directly.
 *
 * The estimate: for each bid period with matching award evidence, find the
 * junior-most holder percentile. P(hold) is the Laplace-smoothed fraction of
 * periods in which the pilot's percentile was senior enough to be inside
 * that boundary. Smoothing keeps small samples honest (never 0% or 100%).
 */

export interface EmpiricalMatch {
  seniorityNumber: number;
  month: string; // 3-letter, e.g. "JUL"
  year: number;
  similarity: number; // 0-100 from TripMatcher
}

export interface EmpiricalHoldResult {
  probability: number;
  reasoning: string[];
  periodsUsed: number;
}

/** Roster map key: "JUL-2026" (3-letter month, uppercase). */
export type RosterMap = Map<string, number[]>;

const MONTH_3 = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];

/** Normalize "February", "FEB ", "feb" → "FEB". Returns null if unknown. */
export function normalizeMonth3(month: string | undefined | null): string | null {
  if (!month) return null;
  const m = month.trim().slice(0, 3).toUpperCase();
  return MONTH_3.includes(m) ? m : null;
}

export function rosterKey(month: string, year: number): string | null {
  const m = normalizeMonth3(month);
  return m ? `${m}-${year}` : null;
}

/**
 * Percentile of a seniority number within a period roster (0-100, lower =
 * more senior — same convention as the rest of the app). The roster must be
 * sorted ascending.
 */
export function percentileWithin(
  sortedRoster: number[],
  seniorityNumber: number
): number {
  if (sortedRoster.length === 0) return 50;
  // Binary search: count of roster members senior to (<=) this number
  let lo = 0;
  let hi = sortedRoster.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedRoster[mid] <= seniorityNumber) lo = mid + 1;
    else hi = mid;
  }
  return Math.round((lo / sortedRoster.length) * 1000) / 10;
}

const MIN_PERIODS = 3;
const MIN_SIMILARITY = 60;

function ordinal(n: number): string {
  const v = Math.round(n);
  const mod100 = v % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
  switch (v % 10) {
    case 1: return `${v}st`;
    case 2: return `${v}nd`;
    case 3: return `${v}rd`;
    default: return `${v}th`;
  }
}

export function computeEmpiricalHold(params: {
  userPercentile: number; // 0-100, lower = more senior
  matches: EmpiricalMatch[];
  rosters: RosterMap;
  bidMonth?: string | null; // month of the package being bid, for seasonal note
}): EmpiricalHoldResult | null {
  const { userPercentile, matches, rosters, bidMonth } = params;

  // Junior-most holder percentile per period, from sufficiently similar awards
  const juniorMostByPeriod = new Map<string, number>();
  const allHolderPercentiles: number[] = [];
  for (const m of matches) {
    if (m.similarity < MIN_SIMILARITY) continue;
    const key = rosterKey(m.month, m.year);
    if (!key) continue;
    const roster = rosters.get(key);
    if (!roster || roster.length === 0) continue;
    const pct = percentileWithin(roster, m.seniorityNumber);
    allHolderPercentiles.push(pct);
    const prev = juniorMostByPeriod.get(key);
    if (prev === undefined || pct > prev) {
      juniorMostByPeriod.set(key, pct);
    }
  }

  const periods = [...juniorMostByPeriod.entries()];
  if (periods.length < MIN_PERIODS) return null;

  const boundaries = periods.map(([, pct]) => pct);
  const wins = boundaries.filter(b => userPercentile <= b).length;
  // Laplace smoothing: (wins+1)/(n+2) — 6/6 periods reads as 88%, not 100%
  const probability = Math.round(((wins + 1) / (periods.length + 2)) * 100);
  const clamped = Math.max(5, Math.min(95, probability));

  const sortedBounds = [...boundaries].sort((a, b) => a - b);
  const minB = sortedBounds[0];
  const maxB = sortedBounds[sortedBounds.length - 1];
  const median =
    sortedBounds[Math.floor((sortedBounds.length - 1) / 2)];

  const yearsSpanned = new Set(periods.map(([k]) => k.split('-')[1]));
  const reasoning: string[] = [
    `📊 Award evidence from ${periods.length} bid period(s) across ${yearsSpanned.size} year(s)`,
    `   Trips like this went as junior as the ${ordinal(minB)}-${ordinal(maxB)} percentile (median ${ordinal(median)})`,
    `   Your position (${ordinal(userPercentile)} percentile) was senior enough in ${wins} of ${periods.length} period(s)`,
  ];

  // Seasonal note: evidence from the same calendar month as the package
  const bidM = normalizeMonth3(bidMonth ?? null);
  if (bidM) {
    const sameMonth = periods.filter(([k]) => k.startsWith(`${bidM}-`));
    if (sameMonth.length > 0) {
      const sameMonthWins = sameMonth.filter(
        ([, b]) => userPercentile <= b
      ).length;
      reasoning.push(
        `   ${bidM} specifically: senior enough in ${sameMonthWins} of ${sameMonth.length} past ${bidM} period(s)`
      );
    }
  }

  if (periods.length < 6) {
    reasoning.push(
      `   ⚠️ Moderate confidence (${periods.length} periods of evidence)`
    );
  } else {
    reasoning.push(
      `   ✓ High confidence (${periods.length} periods of evidence)`
    );
  }

  return { probability: clamped, reasoning, periodsUsed: periods.length };
}
