/**
 * Learns a pilot's BidProfileWeights from their OWN Reasons Report
 * preference rows (preference_text + outcome across periods).
 *
 * Pure function over plain data — no DB/OpenAI imports — so it is
 * unit-testable in scripts/bid-tools-check.ts, and so no pilot's style
 * can leak in as a default: with zero rows it returns a neutral profile.
 */

import type { BidProfileWeights } from '../../shared/bidTypes';

export interface PilotPreferenceRow {
  /** e.g. "Avoid Pairings If Pairing Check-In Station EWR" */
  preferenceText: string;
  /** NAVBLUE reason vocabulary (Honored, Not considered, ...) */
  outcome?: string;
  month?: string;
  year?: number;
}

/** Neutral starting profile — what a brand-new pilot with no history gets. */
export function neutralProfile(): BidProfileWeights {
  return {
    creditLeaning: 0,
    layoverLikes: [],
    layoverDislikes: [],
    checkInStationAvoids: [],
    avoidsRedeyes: false,
    avoidsCarryOut: false,
    preferredPattern: null,
    preferredTripLengths: [],
    preferOffWeekendShare: 0,
  };
}

const CITY_LIST = /((?:[A-Z]{3}(?:,\s*)?)+)/;

function extractCities(text: string, after: RegExp): string[] {
  const m = text.match(new RegExp(after.source + '\\s*' + CITY_LIST.source));
  if (!m) return [];
  return m[1]
    .split(/,\s*/)
    .map(c => c.trim().toUpperCase())
    .filter(c => /^[A-Z]{3}$/.test(c));
}

function topByCount(counts: Map<string, number>, minCount: number): string[] {
  return [...counts.entries()]
    .filter(([, n]) => n >= minCount)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
}

function bump(map: Map<string, number>, key: string, by = 1) {
  map.set(key, (map.get(key) || 0) + by);
}

/**
 * Derive profile weights from a pilot's preference rows. `periods` is how
 * many distinct bid periods the rows span (for recurrence thresholds — a
 * signal must appear in at least ~a third of periods, min 2, to count as
 * a stable preference rather than a one-month experiment).
 */
export function learnProfile(
  rows: PilotPreferenceRow[],
  periods: number
): { weights: BidProfileWeights; signals: Record<string, number> } {
  const weights = neutralProfile();
  const signals: Record<string, number> = {};
  if (rows.length === 0 || periods === 0) {
    return { weights, signals };
  }
  const recurrence = Math.max(2, Math.ceil(periods / 3));

  const likeCities = new Map<string, number>();
  const dislikeCities = new Map<string, number>();
  const stationAvoids = new Map<string, number>();
  const tripLengths = new Map<string, number>();
  const patterns = new Map<string, number>();
  let minWindow = 0;
  let maxWindow = 0;
  let redeyeAvoids = 0;
  let carryOutAvoids = 0;
  let preferOffDates = 0;
  let preferOffWeekend = 0;

  for (const row of rows) {
    const text = row.preferenceText;
    const isAvoid = /^Avoid Pairings/i.test(text);
    const isAward = /^Award Pairings/i.test(text);

    // Layover likes: Award ... Layover(s) In <cities>; dislikes: the same
    // under Avoid, or "Not Any Layover In" under Award.
    if (isAward) {
      for (const c of extractCities(text, /Layovers? In/)) bump(likeCities, c);
      for (const c of extractCities(text, /Not Any Layover In/)) {
        bump(dislikeCities, c);
        // extractCities(Layover In) above also matched these; undo.
        bump(likeCities, c, -1);
      }
    }
    if (isAvoid) {
      for (const c of extractCities(text, /Layovers? In/)) bump(dislikeCities, c);
      for (const c of extractCities(text, /Check-In Station/)) bump(stationAvoids, c);
      if (/Redeye/i.test(text)) redeyeAvoids++;
      if (/Carry Out\s*>\s*0/i.test(text)) carryOutAvoids++;
    }

    // Trip-length appetite from Award "Pairing Length = N Days"
    if (isAward) {
      const lm = text.match(/Pairing Length\s*=\s*(\d)/);
      if (lm) bump(tripLengths, lm[1]);
    }

    // Credit leaning from Set Condition credit-window choices
    if (/Set Condition Minimum Credit/i.test(text)) minWindow++;
    if (/Set Condition Maximum Credit/i.test(text)) maxWindow++;

    // Pattern usage: "Pattern Between X And Y Days On ,With Z Days Off"
    const pm = text.match(
      /Pattern Between (\d+) And (\d+) Days On\s*,\s*With (\d+) Days Off/i
    );
    if (pm) bump(patterns, `${pm[1]}|${pm[2]}|${pm[3]}`);

    // Prefer Off weekend share (date list like "Feb 3, 2025")
    if (/^Prefer Off/i.test(text)) {
      const dates = text.match(/[A-Z][a-z]{2} \d{1,2}, \d{4}/g) || [];
      for (const d of dates) {
        const t = new Date(d);
        if (!Number.isNaN(t.getTime())) {
          preferOffDates++;
          const dow = t.getDay();
          if (dow === 0 || dow === 6) preferOffWeekend++;
        }
      }
    }
  }

  weights.layoverLikes = topByCount(likeCities, recurrence).slice(0, 10);
  weights.layoverDislikes = topByCount(dislikeCities, recurrence).slice(0, 10);
  weights.checkInStationAvoids = topByCount(stationAvoids, recurrence);
  weights.avoidsRedeyes = redeyeAvoids >= recurrence;
  weights.avoidsCarryOut = carryOutAvoids >= recurrence;
  weights.preferredTripLengths = topByCount(tripLengths, recurrence).map(n =>
    parseInt(n, 10)
  );
  const topPattern = topByCount(patterns, recurrence)[0];
  if (topPattern) {
    const [a, b, c] = topPattern.split('|').map(n => parseInt(n, 10));
    weights.preferredPattern = {
      daysOnMin: a,
      daysOnMax: b,
      daysOffMin: c,
    };
  }
  // Credit leaning: max-credit windows pull toward +1, min-credit toward
  // -1; scaled by how consistently the pilot sets a window at all.
  const windowTotal = minWindow + maxWindow;
  weights.creditLeaning =
    windowTotal === 0
      ? 0
      : ((maxWindow - minWindow) / windowTotal) *
        Math.min(1, windowTotal / periods);
  weights.preferOffWeekendShare =
    preferOffDates === 0 ? 0 : preferOffWeekend / preferOffDates;

  signals.rows = rows.length;
  signals.periods = periods;
  signals.minWindow = minWindow;
  signals.maxWindow = maxWindow;
  signals.redeyeAvoids = redeyeAvoids;
  signals.carryOutAvoids = carryOutAvoids;
  signals.preferOffDates = preferOffDates;
  return { weights, signals };
}
