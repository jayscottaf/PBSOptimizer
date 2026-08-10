/**
 * Single source of truth for filter-field display vocabulary, shared by the
 * dashboard search filters (smart-filter-system.tsx) and the Bid Builder
 * (bid-builder.tsx) so the same underlying field is always labeled with the
 * same term on every screen.
 *
 * `navblueLabel` is the exact term from the NAVBLUE N-PBS Bidder's Guide
 * (see docs/ai-bidding-coach/navblue-rules.md); `source: 'app'` marks
 * app-invented insights (hold probability, credit/block ratio) that have no
 * NAVBLUE equivalent — the UI badges these so they are never mistaken for
 * real PBS bid properties.
 */

export interface FilterFieldMeta {
  /** Exact Bidder's Guide term, e.g. "Total Layover Time". */
  navblueLabel: string;
  /** Compact label for active-filter chips. */
  shortLabel: string;
  /** One-line plain-English explanation (tooltip). */
  gloss: string;
  /** pbs = real NAVBLUE concept; app = app-invented insight. */
  source: 'pbs' | 'app';
}

export const PBS_FILTER_FIELDS: Record<string, FilterFieldMeta> = {
  // ---- Existing dashboard filters ----------------------------------------
  pairingDays: {
    navblueLabel: 'Pairing Length',
    shortLabel: 'Length',
    gloss: 'Number of days the pairing spans, e.g. a 4-day trip.',
    source: 'pbs',
  },
  creditMin: {
    navblueLabel: 'Credit',
    shortLabel: 'Credit',
    gloss: 'Total credit hours paid for the pairing.',
    source: 'pbs',
  },
  blockMin: {
    navblueLabel: 'Block',
    shortLabel: 'Block',
    gloss: 'Total block (flying) hours in the pairing.',
    source: 'pbs',
  },
  tafbMin: {
    navblueLabel: 'TAFB',
    shortLabel: 'TAFB',
    gloss: 'Time away from base, check-in to check-out.',
    source: 'pbs',
  },
  layoverLocations: {
    navblueLabel: 'Layovers In',
    shortLabel: 'Layovers In',
    gloss: 'Pairings with an overnight layover in any of these cities.',
    source: 'pbs',
  },
  holdProbabilityMin: {
    navblueLabel: 'Hold Probability',
    shortLabel: 'Hold',
    gloss:
      'App-computed likelihood of being awarded this pairing at your seniority. Not a PBS bid property.',
    source: 'app',
  },
  efficiency: {
    navblueLabel: 'Credit/Block Ratio',
    shortLabel: 'C/B',
    gloss:
      'App-computed pay efficiency (credit ÷ block). Not a PBS bid property.',
    source: 'app',
  },

  // ---- New PBS filter fields ---------------------------------------------
  deadheadsMin: {
    navblueLabel: 'Deadhead Legs',
    shortLabel: 'Deadheads',
    gloss: 'Number of deadhead (repositioning, non-flying) legs.',
    source: 'pbs',
  },
  layoverCountMin: {
    navblueLabel: 'Number Of Layovers',
    shortLabel: 'Layover Count',
    gloss: 'How many overnight layovers the pairing includes.',
    source: 'pbs',
  },
  totalLayoverHoursMin: {
    navblueLabel: 'Total Layover Time',
    shortLabel: 'Total LO Time',
    gloss: 'Sum of all layover durations, in hours.',
    source: 'pbs',
  },
  averageDailyCreditMin: {
    navblueLabel: 'Average Daily Credit',
    shortLabel: 'Avg Daily Credit',
    gloss: 'Credit hours divided by pairing length.',
    source: 'pbs',
  },
  averageDailyBlockMin: {
    navblueLabel: 'Average Daily Block Time',
    shortLabel: 'Avg Daily Block',
    gloss: 'Block hours divided by pairing length.',
    source: 'pbs',
  },
  checkInHourMin: {
    navblueLabel: 'Check-In Time',
    shortLabel: 'Check-In',
    gloss: 'Hour of day the pairing checks in (0–23).',
    source: 'pbs',
  },
  checkInStations: {
    navblueLabel: 'Pairing Check-In Station',
    shortLabel: 'Check-In Station',
    gloss:
      'Airport where the pairing begins (first leg departure), e.g. avoid EWR check-ins.',
    source: 'pbs',
  },
  excludeCheckInStations: {
    navblueLabel: 'Check-In Station Not',
    shortLabel: 'No Check-In At',
    gloss:
      'Exclude pairings that begin at these airports (NAVBLUE: Avoid ... If Pairing Check-In Station).',
    source: 'pbs',
  },
  hasRedeye: {
    navblueLabel: 'Duty Is Redeye',
    shortLabel: 'Redeye',
    gloss: 'Whether any leg departs between 22:00 and 04:59.',
    source: 'pbs',
  },
  excludeLayoverCities: {
    navblueLabel: 'Layovers Not In',
    shortLabel: 'No Layovers In',
    gloss: 'Exclude pairings with an overnight layover in any of these cities.',
    source: 'pbs',
  },
};

/**
 * Short bid-period range, e.g. "Aug 31 – Sep 30".
 *
 * A package's month name and its bid period are different things: the
 * September 2026 package runs Aug 31 – Sep 30. Showing the period next to
 * the month name keeps that from reading as a labeling error.
 * Dates are plain "YYYY-MM-DD" strings; parsed as local parts rather than
 * via Date(string), which would treat them as UTC and shift the day back in
 * western timezones.
 */
export function formatBidPeriod(
  start?: string | null,
  end?: string | null
): string | null {
  const parse = (value?: string | null) => {
    const m = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  };
  const s = parse(start);
  const e = parse(end);
  if (!s || !e) {
    return null;
  }
  const fmt = (d: Date) =>
    `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}`;
  return `${fmt(s)} – ${fmt(e)}`;
}

const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Look up meta for a filter key, tolerating Min/Max suffix variants. */
export function filterFieldMeta(key: string): FilterFieldMeta | undefined {
  if (PBS_FILTER_FIELDS[key]) {
    return PBS_FILTER_FIELDS[key];
  }
  const base = key.replace(/Max$/, 'Min');
  return PBS_FILTER_FIELDS[base];
}
