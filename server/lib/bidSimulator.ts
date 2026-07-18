/**
 * Static first-pass bid simulator.
 *
 * Evaluates a structured draft bid against the loaded bid package using the
 * documented NAVBLUE pool semantics (docs/ai-bidding-coach/navblue-rules.md):
 * negatives remove pairings from the pool and scope every Award after them,
 * Awards take from what remains in preference order, Limit caps a single
 * preference, Set Condition picks the credit window, and awarding stops once
 * credit passes the threshold.
 *
 * It deliberately does NOT model substitution, vertical swapping, shuffling,
 * Denial Mode, coverage, other pilots' bids, or pairing date-overlap
 * legality - every result carries those caveats. Hold probability supplies
 * the uncertainty: expectedCredit is the probability-weighted credit.
 */

import type {
  BidPreference,
  DraftBid,
  PairingFilter,
  SimulatedAward,
  SimulationGroupResult,
  SimulationResult,
} from '../../shared/bidTypes';

export interface SimulatorOptions {
  /** Average Line Value for the category. Defaults to 78:00. */
  alv?: number;
  /** Narrowbody caps the window top at 91.5, widebody at 92.5. */
  aircraftCategory?: 'narrowbody' | 'widebody';
  /**
   * Threshold inside the window where PBS stops awarding. Admin-set in the
   * real system and not published in the bid package; defaults to the ALV.
   */
  threshold?: number;
  /** Bid period year, used to anchor Prefer Off date comparisons. */
  bidYear?: number;
  /**
   * Real credit-window bounds observed in a Reasons Report ("Minimum window
   * <062:00> ... Maximum window <082:00>"). When provided they replace the
   * ALV±10 approximation entirely.
   */
  windowMin?: number;
  windowMax?: number;
  /** Where the window/threshold values came from, for the caveat text. */
  windowSource?: string;
}

interface SimPairing {
  pairingNumber: string;
  creditHours: number;
  blockHours: number;
  pairingDays: number;
  holdProbability: number | null;
  deadheads: number;
  checkInHour: number | null;
  layoverCities: string[];
  layoverCount: number;
  totalLayoverHours: number;
  effectiveStart: { month: number; day: number } | null;
  effectiveEnd: { month: number; day: number } | null;
}

/** Layover durations are "HH.MM" strings (e.g. "18.48" = 18h48m). Sum to
 * decimal hours. Mirrors client/src/lib/layover.ts. */
function layoverHours(layovers: any[]): number {
  let minutes = 0;
  for (const l of layovers) {
    const str = String(l?.duration ?? '').trim();
    if (!str) continue;
    const [h, m] = str.split('.');
    minutes +=
      (parseInt(h || '0', 10) || 0) * 60 +
      (parseInt((m || '0').padEnd(2, '0').slice(0, 2), 10) || 0);
  }
  return minutes / 60;
}

const MONTH_TOKENS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  const parsed = parseFloat(String(value ?? ''));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseCheckInHour(checkInTime: unknown): number | null {
  if (!checkInTime) return null;
  const text = String(checkInTime).trim();
  // Formats seen in the data: "10.35" (HH.MM), "0500"/"05:00"
  const dotted = text.match(/^(\d{1,2})[.:](\d{2})$/);
  if (dotted) return parseInt(dotted[1], 10);
  const compact = text.match(/^(\d{2})(\d{2})$/);
  if (compact) return parseInt(compact[1], 10);
  const bare = parseInt(text, 10);
  return Number.isNaN(bare) ? null : Math.min(23, bare);
}

/** Parse "AUG03 ONLY" / "AUG03-AUG28" style effectiveDates text. */
function parseEffectiveDates(text: unknown): {
  start: { month: number; day: number } | null;
  end: { month: number; day: number } | null;
} {
  const tokens = String(text ?? '')
    .toUpperCase()
    .match(/([A-Z]{3})\s*(\d{1,2})/g);
  if (!tokens || tokens.length === 0) return { start: null, end: null };
  const parsed = tokens
    .map(token => {
      const m = token.match(/([A-Z]{3})\s*(\d{1,2})/);
      if (!m || !(m[1] in MONTH_TOKENS)) return null;
      return { month: MONTH_TOKENS[m[1]], day: parseInt(m[2], 10) };
    })
    .filter((d): d is { month: number; day: number } => d !== null);
  if (parsed.length === 0) return { start: null, end: null };
  return { start: parsed[0], end: parsed[parsed.length - 1] };
}

function toSimPairing(p: any): SimPairing {
  let layovers = p.layovers;
  if (typeof layovers === 'string') {
    try {
      layovers = JSON.parse(layovers);
    } catch {
      layovers = [];
    }
  }
  const layoverArr = Array.isArray(layovers) ? layovers : [];
  const layoverCities = layoverArr
    .map((l: any) => String(l?.city ?? '').toUpperCase())
    .filter(Boolean);
  const { start, end } = parseEffectiveDates(p.effectiveDates);
  return {
    pairingNumber: String(p.pairingNumber ?? ''),
    creditHours: toNumber(p.creditHours),
    blockHours: toNumber(p.blockHours),
    pairingDays: p.pairingDays || 1,
    holdProbability:
      p.holdProbability === null || p.holdProbability === undefined
        ? null
        : Number(p.holdProbability),
    deadheads: p.deadheads || 0,
    checkInHour: parseCheckInHour(p.checkInTime),
    layoverCities,
    layoverCount: layoverArr.length,
    totalLayoverHours: layoverHours(layoverArr),
    effectiveStart: start,
    effectiveEnd: end,
  };
}

function matchesFilter(pairing: SimPairing, filter: PairingFilter): boolean {
  if (filter.pairingNumbers && filter.pairingNumbers.length > 0) {
    if (!filter.pairingNumbers.includes(pairing.pairingNumber)) return false;
  }
  if (
    filter.pairingDaysMin !== undefined &&
    pairing.pairingDays < filter.pairingDaysMin
  ) {
    return false;
  }
  if (
    filter.pairingDaysMax !== undefined &&
    pairing.pairingDays > filter.pairingDaysMax
  ) {
    return false;
  }
  if (filter.layoverCities && filter.layoverCities.length > 0) {
    const wanted = filter.layoverCities.map(c => c.toUpperCase());
    if (!pairing.layoverCities.some(city => wanted.includes(city))) {
      return false;
    }
  }
  if (filter.excludeLayoverCities && filter.excludeLayoverCities.length > 0) {
    const unwanted = filter.excludeLayoverCities.map(c => c.toUpperCase());
    if (pairing.layoverCities.some(city => unwanted.includes(city))) {
      return false;
    }
  }
  if (
    filter.layoverCountMin !== undefined &&
    pairing.layoverCount < filter.layoverCountMin
  ) {
    return false;
  }
  if (
    filter.layoverCountMax !== undefined &&
    pairing.layoverCount > filter.layoverCountMax
  ) {
    return false;
  }
  if (
    filter.totalLayoverHoursMin !== undefined &&
    pairing.totalLayoverHours < filter.totalLayoverHoursMin
  ) {
    return false;
  }
  if (
    filter.totalLayoverHoursMax !== undefined &&
    pairing.totalLayoverHours > filter.totalLayoverHoursMax
  ) {
    return false;
  }
  if (filter.creditMin !== undefined && pairing.creditHours < filter.creditMin) {
    return false;
  }
  if (filter.creditMax !== undefined && pairing.creditHours > filter.creditMax) {
    return false;
  }
  if (filter.blockMin !== undefined && pairing.blockHours < filter.blockMin) {
    return false;
  }
  if (filter.blockMax !== undefined && pairing.blockHours > filter.blockMax) {
    return false;
  }
  if (filter.checkInHourMin !== undefined || filter.checkInHourMax !== undefined) {
    if (pairing.checkInHour === null) return false;
    if (
      filter.checkInHourMin !== undefined &&
      pairing.checkInHour < filter.checkInHourMin
    ) {
      return false;
    }
    if (
      filter.checkInHourMax !== undefined &&
      pairing.checkInHour > filter.checkInHourMax
    ) {
      return false;
    }
  }
  if (filter.deadheadsMax !== undefined && pairing.deadheads > filter.deadheadsMax) {
    return false;
  }
  if (filter.deadheadsMin !== undefined && pairing.deadheads < filter.deadheadsMin) {
    return false;
  }
  const days = Math.max(1, pairing.pairingDays);
  const adc = pairing.creditHours / days;
  if (
    filter.averageDailyCreditMin !== undefined &&
    adc < filter.averageDailyCreditMin
  ) {
    return false;
  }
  if (
    filter.averageDailyCreditMax !== undefined &&
    adc > filter.averageDailyCreditMax
  ) {
    return false;
  }
  const adb = pairing.blockHours / days;
  if (
    filter.averageDailyBlockMin !== undefined &&
    adb < filter.averageDailyBlockMin
  ) {
    return false;
  }
  if (
    filter.averageDailyBlockMax !== undefined &&
    adb > filter.averageDailyBlockMax
  ) {
    return false;
  }
  return true;
}

/**
 * Whether a pairing could be on duty on the given date. A pairing's
 * effectiveDates span its operating departures; any departure within
 * [start, end] occupies [departure, departure + pairingDays). We therefore
 * flag a touch when date falls in [start, end + pairingDays) - a
 * conservative approximation, since the package does not enumerate the
 * individual operating dates.
 */
function touchesDate(pairing: SimPairing, isoDate: string): boolean {
  if (!pairing.effectiveStart) return false;
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const target = parseInt(m[2], 10) * 100 + parseInt(m[3], 10);
  const start =
    pairing.effectiveStart.month * 100 + pairing.effectiveStart.day;
  const endBase = pairing.effectiveEnd ?? pairing.effectiveStart;
  // Add trip length to the last departure day (approximate across month ends).
  let endMonth = endBase.month;
  let endDay = endBase.day + Math.max(0, pairing.pairingDays - 1);
  if (endDay > 31) {
    endDay -= 31;
    endMonth = (endMonth % 12) + 1;
  }
  const end = endMonth * 100 + endDay;
  if (start <= end) return target >= start && target <= end;
  // Range wraps a year boundary (e.g. DEC28-JAN02)
  return target >= start || target <= end;
}

function creditWindow(
  windowType: 'normal' | 'min' | 'max' | 'mid',
  alv: number,
  cap: number,
  realBounds?: { min: number; max: number }
): { min: number; max: number } {
  // Real observed bounds (from a Reasons Report) replace the ALV±10
  // approximation; Set Condition sub-windows split at the midpoint.
  const bottom = realBounds ? realBounds.min : alv - 10;
  const top = realBounds ? Math.min(realBounds.max, cap) : Math.min(alv + 10, cap);
  const middle = realBounds ? (bottom + top) / 2 : alv;
  switch (windowType) {
    case 'min':
      return { min: bottom, max: middle };
    case 'max':
      return { min: middle, max: top };
    case 'mid':
      return { min: middle - 5, max: Math.min(middle + 5, cap) };
    default:
      return { min: bottom, max: top };
  }
}

export function simulateBid(
  bid: DraftBid,
  rawPairings: any[],
  options: SimulatorOptions = {}
): SimulationResult {
  const alv = options.alv ?? 78;
  const cap = options.aircraftCategory === 'widebody' ? 92.5 : 91.5;
  const realBounds =
    options.windowMin !== undefined && options.windowMax !== undefined
      ? { min: options.windowMin, max: options.windowMax }
      : undefined;
  const allPairings = rawPairings.map(toSimPairing);

  const caveats = [
    'Static first pass: substitution, vertical swapping, shuffling, Denial Mode, and coverage awards are NOT modeled.',
    'Other pilots\' bids are unknown; hold probability per pairing is the only competition signal.',
    'Pairing date-overlap legality and FAR/PWA rest rules between awards are not checked.',
    'Prefer Off matching approximates operating dates from the effectiveDates range.',
    realBounds
      ? `Credit window ${realBounds.min.toFixed(1)}-${realBounds.max.toFixed(1)} and threshold ${(options.threshold ?? alv).toFixed(1)} come from ${options.windowSource ?? 'an imported Reasons Report'}; the current month's admin values may differ.`
      : `Threshold is admin-set and not published; this run assumes ${(options.threshold ?? alv).toFixed(1)} credit hours.`,
  ];

  const groupResults: SimulationGroupResult[] = [];
  let chosen: SimulationGroupResult | null = null;
  let chosenWindow = creditWindow('normal', alv, cap, realBounds);
  let chosenThreshold = options.threshold ?? alv;

  bid.groups.forEach((group, groupIndex) => {
    if (group.type === 'reserve') {
      groupResults.push({
        groupIndex,
        type: 'reserve',
        poolAfterNegatives: 0,
        awards: [],
        creditFromAwards: 0,
        inertPreferences: [
          {
            preferenceIndex: 0,
            reason:
              'Reserve line construction is not simulated (no optimization or Denial Mode applies to reserve anyway).',
          },
        ],
      });
      return;
    }

    let windowType: 'normal' | 'min' | 'max' | 'mid' = 'normal';
    let pool = [...allPairings];
    const awards: SimulatedAward[] = [];
    const inert: SimulationGroupResult['inertPreferences'] = [];
    let awardPrefCount = 0;
    const threshold = options.threshold ?? alv;

    for (let i = 0; i < group.preferences.length; i++) {
      const pref: BidPreference = group.preferences[i];
      if (pref.type === 'setConditionCredit') {
        windowType = pref.creditWindow ?? 'normal';
        continue;
      }
      if (pref.type === 'clearScheduleStartNext') {
        // CSSN is forced to the bottom of the group; nothing to evaluate
        // statically - it only matters when the group cannot complete.
        continue;
      }
      if (pref.type === 'avoid' && pref.filter) {
        const before = pool.length;
        pool = pool.filter(p => !matchesFilter(p, pref.filter!));
        if (pool.length === before) {
          inert.push({
            preferenceIndex: i,
            reason: 'Avoid matched no pairings in this package.',
          });
        }
        continue;
      }
      if (pref.type === 'preferOff' && pref.preferOffDates) {
        const before = pool.length;
        pool = pool.filter(
          p => !pref.preferOffDates!.some(date => touchesDate(p, date))
        );
        if (pool.length === before) {
          inert.push({
            preferenceIndex: i,
            reason: 'No pairings touch the requested days off.',
          });
        }
        continue;
      }
      if (pref.type === 'award') {
        awardPrefCount++;
        const window = creditWindow(windowType, alv, cap, realBounds);
        const currentCredit = awards.reduce((s, a) => s + a.creditHours, 0);
        if (currentCredit > Math.min(threshold, window.max)) {
          inert.push({
            preferenceIndex: i,
            reason: 'Block already complete before this preference (credit past threshold).',
          });
          continue;
        }
        const matches = pool
          .filter(p => (pref.filter ? matchesFilter(p, pref.filter) : true))
          .sort((a, b) => {
            const pa = a.holdProbability ?? 50;
            const pb = b.holdProbability ?? 50;
            if (pb !== pa) return pb - pa;
            return b.creditHours - a.creditHours;
          });
        if (matches.length === 0) {
          inert.push({
            preferenceIndex: i,
            reason: 'No pairings available (pool emptied by earlier negatives or no attribute match).',
          });
          continue;
        }
        let taken = 0;
        for (const match of matches) {
          const credit = awards.reduce((s, a) => s + a.creditHours, 0);
          if (credit > Math.min(threshold, window.max)) break;
          if (pref.limit !== undefined && taken >= pref.limit) break;
          if (credit + match.creditHours > window.max) continue;
          awards.push({
            pairingNumber: match.pairingNumber,
            creditHours: match.creditHours,
            pairingDays: match.pairingDays,
            holdProbability: match.holdProbability,
            awardedByPreference: i + 1,
            groupIndex,
          });
          pool = pool.filter(p => p !== match);
          taken++;
        }
        if (taken === 0) {
          inert.push({
            preferenceIndex: i,
            reason:
              pref.limit !== undefined
                ? 'Matched pairings but none taken (limit or window ceiling).'
                : 'Matched pairings would exceed the credit window ceiling.',
          });
        }
      }
    }

    const result: SimulationGroupResult = {
      groupIndex,
      type: 'pairings',
      poolAfterNegatives: pool.length,
      awards,
      creditFromAwards: awards.reduce((s, a) => s + a.creditHours, 0),
      inertPreferences: inert,
    };
    if (awardPrefCount === 0) {
      result.inertPreferences.push({
        preferenceIndex: group.preferences.length,
        reason:
          'No Award preferences: the system-generated Award Pairings would fill this line from the remaining pool.',
      });
    }
    groupResults.push(result);

    // First pairing group that reaches the window minimum wins.
    const window = creditWindow(windowType, alv, cap, realBounds);
    if (!chosen && result.creditFromAwards >= window.min) {
      chosen = result;
      chosenWindow = window;
      chosenThreshold = threshold;
    }
  });

  // No group completed: report the best pairing-group attempt.
  if (!chosen) {
    const pairingGroups = groupResults.filter(g => g.type === 'pairings');
    chosen =
      pairingGroups.sort((a, b) => b.creditFromAwards - a.creditFromAwards)[0] ??
      null;
    caveats.push(
      'No bid group reached the credit-window minimum from its own Award preferences; in the real system the system-generated Award Pairings, shuffling, and Denial Mode would fill or alter the line.'
    );
  }

  const awards = chosen ? (chosen as SimulationGroupResult).awards : [];
  const totalCredit = awards.reduce((s: number, a: SimulatedAward) => s + a.creditHours, 0);
  const expectedCredit = awards.reduce(
    (s: number, a: SimulatedAward) => s + a.creditHours * ((a.holdProbability ?? 50) / 100),
    0
  );

  return {
    awards,
    totalCredit: Math.round(totalCredit * 100) / 100,
    expectedCredit: Math.round(expectedCredit * 100) / 100,
    lineComplete: totalCredit >= chosenWindow.min,
    window: {
      min: chosenWindow.min,
      max: chosenWindow.max,
      threshold: chosenThreshold,
      alv,
    },
    groupResults,
    caveats,
  };
}
