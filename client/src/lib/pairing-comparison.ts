import type { Pairing } from './api';
import {
  decimalHoursToMinutes,
  printedDurationMinutes,
} from '@shared/durations';

export interface PairingComparison {
  id: number;
  pairingNumber: string;
  route: string;
  effectiveDates: string;
  creditMinutes: number | null;
  blockMinutes: number | null;
  tafbMinutes: number | null;
  creditBlockRatio: number | null;
  pairingDays: number | null;
  holdProbability: number | null;
  longestLayoverMinutes: number | null;
  totalLayoverMinutes: number | null;
  layoverCities: string[];
  deadheads: number | null;
  checkInStation: string | null;
  checkInTime: string | null;
  hasRedeye: boolean;
  holdReasoning: string[];
}

export type ComparisonMetric =
  | 'creditMinutes'
  | 'blockMinutes'
  | 'tafbMinutes'
  | 'creditBlockRatio'
  | 'pairingDays'
  | 'holdProbability'
  | 'longestLayoverMinutes'
  | 'totalLayoverMinutes'
  | 'deadheads';

export type MetricPreference = 'higher' | 'lower';

/**
 * Default interpretation used when the comparison UI marks a metric as best.
 * Callers can pass a different preference to the helpers when the pilot's
 * priorities differ (for example, preferring a long layover over short TAFB).
 */
export const PAIRING_COMPARISON_METRIC_PREFERENCES: Readonly<
  Record<ComparisonMetric, MetricPreference>
> = {
  creditMinutes: 'higher',
  blockMinutes: 'lower',
  tafbMinutes: 'lower',
  creditBlockRatio: 'higher',
  pairingDays: 'lower',
  holdProbability: 'higher',
  longestLayoverMinutes: 'higher',
  totalLayoverMinutes: 'higher',
  deadheads: 'lower',
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function finiteNonNegative(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function validMinutes(value: number): number | null {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function textOrNull(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function parseTafbMinutes(value: unknown): number | null {
  const text = textOrNull(value);
  if (!text) {
    return null;
  }

  // Older fixtures and some imports retain an explicit day prefix.
  const dayTime = text.match(/^(\d+)\s*d\s*(\d{1,2})[.:](\d{2})$/i);
  if (dayTime) {
    const days = Number(dayTime[1]);
    const hours = Number(dayTime[2]);
    const minutes = Number(dayTime[3]);
    if (hours <= 23 && minutes <= 59) {
      return days * 24 * 60 + hours * 60 + minutes;
    }
    return null;
  }

  return validMinutes(printedDurationMinutes(text));
}

function formatClockTime(value: unknown): string | null {
  const text = textOrNull(value);
  if (!text) {
    return null;
  }

  const separated = text.match(/^(\d{1,2})[.:](\d{2})$/);
  const compact = text.match(/^(\d{2})(\d{2})$/);
  const match = separated ?? compact;
  if (!match) {
    return text;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return text;
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function segmentDay(segment: UnknownRecord): number | null {
  const numericDay = finiteNonNegative(segment.day);
  if (numericDay !== null && numericDay >= 1) {
    return Math.floor(numericDay);
  }

  const printedDay = textOrNull(segment.date)?.toUpperCase();
  if (printedDay && /^[A-Z]$/.test(printedDay)) {
    return printedDay.charCodeAt(0) - 64;
  }
  return null;
}

function derivePairingDays(pairing: Pairing, segments: unknown[] | null) {
  const supplied = finiteNonNegative(pairing.pairingDays);
  if (supplied !== null && supplied >= 1) {
    return Math.floor(supplied);
  }

  let lastDay: number | null = null;
  for (const value of segments ?? []) {
    const segment = asRecord(value);
    if (!segment) {
      continue;
    }
    const day = segmentDay(segment);
    if (day !== null && (lastDay === null || day > lastDay)) {
      lastDay = day;
    }
  }
  return lastDay;
}

function deriveLayovers(layoversValue: unknown) {
  const layovers = asArray(layoversValue);
  if (layovers === null) {
    return {
      longestLayoverMinutes: null,
      totalLayoverMinutes: null,
      layoverCities: [] as string[],
    };
  }

  const cities: string[] = [];
  const seenCities = new Set<string>();
  const durations: number[] = [];
  let durationMissing = false;

  for (const value of layovers) {
    const layover = asRecord(value);
    if (!layover) {
      durationMissing = true;
      continue;
    }

    const city = textOrNull(layover.city)?.toUpperCase();
    if (city && !seenCities.has(city)) {
      seenCities.add(city);
      cities.push(city);
    }

    const duration = textOrNull(layover.duration);
    const minutes = duration
      ? validMinutes(printedDurationMinutes(duration))
      : null;
    if (minutes === null) {
      durationMissing = true;
    } else {
      durations.push(minutes);
    }
  }

  if (layovers.length === 0) {
    return {
      longestLayoverMinutes: 0,
      totalLayoverMinutes: 0,
      layoverCities: cities,
    };
  }

  return {
    longestLayoverMinutes: durationMissing ? null : Math.max(...durations),
    totalLayoverMinutes: durationMissing
      ? null
      : durations.reduce((sum, minutes) => sum + minutes, 0),
    layoverCities: cities,
  };
}

function deriveHoldReasoning(value: unknown): string[] {
  return (asArray(value) ?? [])
    .map(item => textOrNull(item))
    .filter((item): item is string => item !== null);
}

function isRedeyeDeparture(value: unknown) {
  const text = textOrNull(value);
  if (!text) {
    return false;
  }
  const match = text.match(/^(\d{1,2})[.:]?(\d{2})/);
  if (!match) {
    return false;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 && (hour >= 22 || hour < 5);
}

export function buildPairingComparison(pairing: Pairing): PairingComparison {
  const creditMinutes = validMinutes(
    decimalHoursToMinutes(pairing.creditHours)
  );
  const blockMinutes = validMinutes(decimalHoursToMinutes(pairing.blockHours));
  const segments = asArray(pairing.flightSegments);
  const firstSegment = asRecord(segments?.[0]);
  const layovers = deriveLayovers(pairing.layovers);
  const suppliedCheckIn = formatClockTime(pairing.checkInTime);
  const segmentCheckIn = formatClockTime(firstSegment?.departureTime);
  const holdProbability = finiteNonNegative(pairing.holdProbability);
  const deadheads = finiteNonNegative(pairing.deadheads);

  return {
    id: pairing.id,
    pairingNumber: textOrNull(pairing.pairingNumber) ?? String(pairing.id),
    route: textOrNull(pairing.route) ?? '',
    effectiveDates: textOrNull(pairing.effectiveDates) ?? '',
    creditMinutes,
    blockMinutes,
    tafbMinutes: parseTafbMinutes(pairing.tafb),
    creditBlockRatio:
      creditMinutes !== null && blockMinutes !== null && blockMinutes > 0
        ? creditMinutes / blockMinutes
        : null,
    pairingDays: derivePairingDays(pairing, segments),
    holdProbability,
    longestLayoverMinutes: layovers.longestLayoverMinutes,
    totalLayoverMinutes: layovers.totalLayoverMinutes,
    layoverCities: layovers.layoverCities,
    deadheads: deadheads === null ? null : Math.floor(deadheads),
    checkInStation: textOrNull(firstSegment?.departure)?.toUpperCase() ?? null,
    checkInTime: suppliedCheckIn ?? segmentCheckIn,
    hasRedeye: (segments ?? []).some(value => {
      const segment = asRecord(value);
      return segment ? isRedeyeDeparture(segment.departureTime) : false;
    }),
    holdReasoning: deriveHoldReasoning(pairing.holdProbabilityReasoning),
  };
}

export function buildPairingComparisons(
  pairings: Pairing[]
): PairingComparison[] {
  return pairings.map(buildPairingComparison);
}

export function bestPairingIds(
  comparisons: PairingComparison[],
  metric: ComparisonMetric,
  preference: MetricPreference
): number[] {
  let bestValue: number | null = null;
  const ids: number[] = [];

  for (const comparison of comparisons) {
    const value = comparison[metric];
    if (value === null || !Number.isFinite(value)) {
      continue;
    }

    if (bestValue === null) {
      bestValue = value;
      ids.push(comparison.id);
      continue;
    }

    const difference = value - bestValue;
    if (Math.abs(difference) < Number.EPSILON * 100) {
      if (!ids.includes(comparison.id)) {
        ids.push(comparison.id);
      }
      continue;
    }

    const isBetter = preference === 'higher' ? difference > 0 : difference < 0;
    if (isBetter) {
      bestValue = value;
      ids.splice(0, ids.length, comparison.id);
    }
  }

  return ids;
}

export function bestPairingId(
  comparisons: PairingComparison[],
  metric: ComparisonMetric,
  preference: MetricPreference
): number | null {
  return bestPairingIds(comparisons, metric, preference)[0] ?? null;
}
