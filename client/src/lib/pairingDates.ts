/**
 * Client-side access to a pairing's departure dates. The expansion itself
 * lives in shared/operatingDates.ts so the browser and the server simulator
 * resolve exactly the same dates.
 */
import {
  expandOperatingDays,
  isoOfEpochDay,
  periodMonthNumber,
} from '../../../shared/operatingDates';

/**
 * Operating-day facts as stored on the pairing row (resolved by the server
 * from the package header).
 */
export interface StoredOperatingDays {
  operatingDows?: number[] | null;
  exceptDates?: string[] | null;
}

const MS_PER_DAY = 86_400_000;

/** Epoch day -> local-midnight Date, matching the calendar UI's dates. */
function localDateOfEpochDay(day: number): Date {
  const utc = new Date(day * MS_PER_DAY);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}

/**
 * Every date the pairing departs on.
 *
 * `periodMonth` (the bid package's month, name or 1-12) anchors ranges that
 * cross New Year: a "DEC28-JAN02" trip in a January package started the
 * previous December. Without it the range's own first month is the anchor,
 * which is right for every range that stays inside one year.
 */
function departureEpochDays(
  effectiveDates: string,
  year: number,
  stored?: StoredOperatingDays,
  periodMonth?: string | number | null
): number[] {
  const month =
    typeof periodMonth === 'number'
      ? periodMonth
      : (periodMonthNumber(periodMonth) ??
        periodMonthNumber(
          String(effectiveDates ?? '').match(/[A-Z]{3}/i)?.[0]
        ));
  if (!month) {
    return [];
  }
  return expandOperatingDays(
    {
      effectiveDates,
      operatingDows: stored?.operatingDows ?? null,
      exceptDates: stored?.exceptDates ?? null,
    },
    { month, year }
  );
}

export function calculateValidStartDates(
  effectiveDates: string,
  year: number,
  _pairingDays: number,
  stored?: StoredOperatingDays,
  periodMonth?: string | number | null
): Date[] {
  return departureEpochDays(effectiveDates, year, stored, periodMonth).map(
    localDateOfEpochDay
  );
}

/** Departure dates as "YYYY-MM-DD", ascending. */
export function departureDates(
  effectiveDates: string,
  year: number,
  stored?: StoredOperatingDays,
  periodMonth?: string | number | null
): string[] {
  return departureEpochDays(effectiveDates, year, stored, periodMonth).map(
    isoOfEpochDay
  );
}

const MONTH_LABELS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];

/**
 * Compact list of departures, grouped by month with runs of three or more
 * consecutive days collapsed: "AUG 15, 21, 22, 24, 27–29" or
 * "JUL 30, 31 · AUG 1". Shows every date (unlike the printed range), so a
 * trip that departs seven times never reads as two dates.
 */
export function formatDepartureDates(isoDates: string[]): string {
  const months: { label: string; days: number[] }[] = [];
  for (const iso of isoDates) {
    const [year, month, day] = iso.split('-').map(Number);
    const label = MONTH_LABELS[month - 1];
    if (!label || !day) continue;
    const key = `${label}${year}`;
    const last = months[months.length - 1];
    if (last && last.label === key) last.days.push(day);
    else months.push({ label: key, days: [day] });
  }
  return months
    .map(({ label, days }) => {
      const parts: string[] = [];
      for (let i = 0; i < days.length; ) {
        let j = i;
        while (j + 1 < days.length && days[j + 1] === days[j] + 1) j++;
        if (j - i >= 2) parts.push(`${days[i]}–${days[j]}`);
        else for (let k = i; k <= j; k++) parts.push(String(days[k]));
        i = j + 1;
      }
      return `${label.slice(0, 3)} ${parts.join(', ')}`;
    })
    .join(' · ');
}

/**
 * Get all dates covered by a pairing starting on a specific date
 */
export function getPairingCoveredDates(
  startDate: Date,
  pairingDays: number
): Date[] {
  const dates: Date[] = [];
  for (let i = 0; i < pairingDays; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    dates.push(date);
  }
  return dates;
}

/**
 * Check if a pairing conflicts with preferred days off
 * Returns true if there's a conflict (pairing should be excluded)
 */
export function pairingConflictsWithDaysOff(
  effectiveDates: string,
  year: number,
  pairingDays: number,
  preferredDaysOff: Date[],
  stored?: StoredOperatingDays,
  periodMonth?: string | number | null
): boolean {
  const validStartDates = calculateValidStartDates(
    effectiveDates,
    year,
    pairingDays,
    stored,
    periodMonth
  );

  const normalizeDate = (date: Date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  const daysOffTimestamps = preferredDaysOff.map(normalizeDate);

  // Check if ANY valid start date would result in the pairing covering a day off
  for (const startDate of validStartDates) {
    const coveredDates = getPairingCoveredDates(startDate, pairingDays);

    for (const coveredDate of coveredDates) {
      if (daysOffTimestamps.includes(normalizeDate(coveredDate))) {
        // This pairing would cover a preferred day off - exclude it
        return true;
      }
    }
  }

  return false;
}
