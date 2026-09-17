export type CommuteFitStatus =
  | 'both'
  | 'commute-in-only'
  | 'commute-home-only'
  | 'overnight-needed'
  | 'unknown';

export interface CommuteFitThresholds {
  /** Earliest report time the pilot can make, in local minutes after midnight. */
  earliestAcceptableReportMinutes: number;
  /** Latest release time the pilot can accept, in local minutes after midnight. */
  latestAcceptableReleaseMinutes: number;
  /** Extra time required between arriving at base and reporting for duty. */
  inboundBufferMinutes?: number;
  /** Extra time required between release and the pilot's latest trip home. */
  outboundBufferMinutes?: number;
}

export interface CommuteFitPreferences extends CommuteFitThresholds {
  enabled: boolean;
  onlyShowBothWays: boolean;
  inboundBufferMinutes: number;
  outboundBufferMinutes: number;
}

export const DEFAULT_COMMUTE_FIT_PREFERENCES: CommuteFitPreferences = {
  enabled: false,
  onlyShowBothWays: false,
  earliestAcceptableReportMinutes: 8 * 60,
  latestAcceptableReleaseMinutes: 22 * 60,
  inboundBufferMinutes: 0,
  outboundBufferMinutes: 0,
};

export interface CommuteFitResult {
  status: CommuteFitStatus;
  canCommuteIn: boolean | null;
  canCommuteHome: boolean | null;
  reportMinutes: number | null;
  releaseMinutes: number | null;
  reportDayOffset: number | null;
  releaseDayOffset: number | null;
  reportLabel: string;
  releaseLabel: string;
  reasons: string[];
}

interface FlightSegmentLike {
  date?: unknown;
  day?: unknown;
  departureTime?: unknown;
  arrivalTime?: unknown;
}

interface ParsedTime {
  minutes: number;
  dayCarry: number;
}

interface NormalizedSegment {
  departureAbsolute: number | null;
  arrivalAbsolute: number | null;
  departureDayOffset: number;
  arrivalDayOffset: number;
}

const MINUTES_PER_DAY = 24 * 60;
const REPORT_LEAD_MINUTES = 60;
const RELEASE_TRAIL_MINUTES = 30;

function parseScheduleTime(value: unknown): ParsedTime | null {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  const raw = String(value).trim();
  const separated = raw.match(/^(\d{1,2})[.:](\d{2})$/);
  const compact = raw.match(/^(\d{1,2})(\d{2})$/);
  const match = separated ?? compact;
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    minutes < 0 ||
    minutes > 59 ||
    hours < 0 ||
    hours > 24 ||
    (hours === 24 && minutes !== 0)
  ) {
    return null;
  }

  return hours === 24
    ? { minutes: 0, dayCarry: 1 }
    : { minutes: hours * 60 + minutes, dayCarry: 0 };
}

function parseSegments(value: unknown): FlightSegmentLike[] | null {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }

  if (!Array.isArray(parsed)) {
    return null;
  }

  return parsed.filter(
    (segment): segment is FlightSegmentLike =>
      typeof segment === 'object' && segment !== null
  );
}

function explicitDayOffset(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) {
    return value - 1;
  }

  const raw = String(value ?? '')
    .trim()
    .toUpperCase();
  if (/^[A-Z]$/.test(raw)) {
    return raw.charCodeAt(0) - 'A'.charCodeAt(0);
  }
  if (/^\d+$/.test(raw)) {
    const day = Number(raw);
    return day >= 1 ? day - 1 : null;
  }

  return null;
}

function normalizeSegments(segments: FlightSegmentLike[]): NormalizedSegment[] {
  const namedDays = new Map<string, number>();
  let nextNamedDay = 0;
  let inferredDay = 0;
  let previousDepartureAbsolute: number | null = null;

  return segments.map(segment => {
    const marker = segment.date ?? segment.day;
    const parsedExplicitDay = explicitDayOffset(marker);
    let dayOffset = parsedExplicitDay;

    if (dayOffset === null) {
      const namedMarker = String(marker ?? '')
        .trim()
        .toUpperCase();
      if (namedMarker) {
        if (!namedDays.has(namedMarker)) {
          namedDays.set(namedMarker, nextNamedDay);
          nextNamedDay += 1;
        }
        dayOffset = namedDays.get(namedMarker) ?? inferredDay;
      } else {
        dayOffset = inferredDay;
      }
    }

    const departure = parseScheduleTime(segment.departureTime);
    let departureAbsolute = departure
      ? dayOffset * MINUTES_PER_DAY +
        departure.minutes +
        departure.dayCarry * MINUTES_PER_DAY
      : null;

    if (departureAbsolute !== null && parsedExplicitDay === null) {
      while (
        previousDepartureAbsolute !== null &&
        departureAbsolute < previousDepartureAbsolute
      ) {
        dayOffset += 1;
        departureAbsolute += MINUTES_PER_DAY;
      }
    }

    const arrival = parseScheduleTime(segment.arrivalTime);
    let arrivalAbsolute = arrival
      ? dayOffset * MINUTES_PER_DAY +
        arrival.minutes +
        arrival.dayCarry * MINUTES_PER_DAY
      : null;

    if (
      arrivalAbsolute !== null &&
      departureAbsolute !== null &&
      arrivalAbsolute < departureAbsolute
    ) {
      arrivalAbsolute += MINUTES_PER_DAY;
    }

    if (departureAbsolute !== null) {
      previousDepartureAbsolute = departureAbsolute;
      inferredDay = Math.floor(departureAbsolute / MINUTES_PER_DAY);
    }
    if (arrivalAbsolute !== null) {
      inferredDay = Math.max(
        inferredDay,
        Math.floor(arrivalAbsolute / MINUTES_PER_DAY)
      );
    }
    nextNamedDay = Math.max(nextNamedDay, dayOffset + 1);

    return {
      departureAbsolute,
      arrivalAbsolute,
      departureDayOffset:
        departureAbsolute === null
          ? dayOffset
          : Math.floor(departureAbsolute / MINUTES_PER_DAY),
      arrivalDayOffset:
        arrivalAbsolute === null
          ? dayOffset
          : Math.floor(arrivalAbsolute / MINUTES_PER_DAY),
    };
  });
}

function isMinuteOfDay(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value < MINUTES_PER_DAY;
}

function isBuffer(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= MINUTES_PER_DAY;
}

function clockMinutes(absoluteMinutes: number): number {
  return (
    ((absoluteMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  );
}

function formatClock(minutes: number): string {
  const hours = Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0');
  const remainder = (minutes % 60).toString().padStart(2, '0');
  return `${hours}:${remainder}`;
}

function formatDay(dayOffset: number): string {
  if (dayOffset < 0) {
    return 'prior day';
  }
  return `day ${dayOffset + 1}`;
}

function formatDutyLabel(absoluteMinutes: number): string {
  return `${formatClock(clockMinutes(absoluteMinutes))} · ${formatDay(
    Math.floor(absoluteMinutes / MINUTES_PER_DAY)
  )}`;
}

function unknownResult(reason: string): CommuteFitResult {
  return {
    status: 'unknown',
    canCommuteIn: null,
    canCommuteHome: null,
    reportMinutes: null,
    releaseMinutes: null,
    reportDayOffset: null,
    releaseDayOffset: null,
    reportLabel: 'Unknown',
    releaseLabel: 'Unknown',
    reasons: [reason],
  };
}

/**
 * Estimates commute fit from the printed pairing times and user-selected local
 * cutoffs. It intentionally does not claim that a real airline itinerary is
 * available. Report is one hour before the first departure; release is thirty
 * minutes after the final arrival.
 */
export function assessCommuteFit(
  flightSegments: unknown,
  thresholds: CommuteFitThresholds
): CommuteFitResult {
  const inboundBufferMinutes = thresholds.inboundBufferMinutes ?? 0;
  const outboundBufferMinutes = thresholds.outboundBufferMinutes ?? 0;

  if (
    !isMinuteOfDay(thresholds.earliestAcceptableReportMinutes) ||
    !isMinuteOfDay(thresholds.latestAcceptableReleaseMinutes) ||
    !isBuffer(inboundBufferMinutes) ||
    !isBuffer(outboundBufferMinutes)
  ) {
    return unknownResult('Set valid local commute times and buffers.');
  }

  const segments = parseSegments(flightSegments);
  if (!segments?.length) {
    return unknownResult('Flight times are unavailable for this pairing.');
  }

  const normalized = normalizeSegments(segments);
  const firstDeparture = normalized.find(
    segment => segment.departureAbsolute !== null
  );
  const finalArrival = [...normalized]
    .reverse()
    .find(segment => segment.arrivalAbsolute !== null);

  if (
    firstDeparture?.departureAbsolute === null ||
    firstDeparture?.departureAbsolute === undefined ||
    finalArrival?.arrivalAbsolute === null ||
    finalArrival?.arrivalAbsolute === undefined
  ) {
    return unknownResult(
      'The first departure or final arrival time is missing.'
    );
  }

  const reportAbsolute = firstDeparture.departureAbsolute - REPORT_LEAD_MINUTES;
  const releaseAbsolute = finalArrival.arrivalAbsolute + RELEASE_TRAIL_MINUTES;

  const reportDayOffset = Math.floor(reportAbsolute / MINUTES_PER_DAY);
  const releaseDayOffset = Math.floor(releaseAbsolute / MINUTES_PER_DAY);
  const commuteInCutoffAbsolute =
    firstDeparture.departureDayOffset * MINUTES_PER_DAY +
    thresholds.earliestAcceptableReportMinutes +
    inboundBufferMinutes;
  const commuteHomeCutoffAbsolute =
    finalArrival.arrivalDayOffset * MINUTES_PER_DAY +
    thresholds.latestAcceptableReleaseMinutes -
    outboundBufferMinutes;

  const canCommuteIn = reportAbsolute >= commuteInCutoffAbsolute;
  const canCommuteHome = releaseAbsolute <= commuteHomeCutoffAbsolute;
  const status: CommuteFitStatus = canCommuteIn
    ? canCommuteHome
      ? 'both'
      : 'commute-in-only'
    : canCommuteHome
      ? 'commute-home-only'
      : 'overnight-needed';

  const reportLabel = formatDutyLabel(reportAbsolute);
  const releaseLabel = formatDutyLabel(releaseAbsolute);
  const commuteInCutoffLabel = formatClock(
    clockMinutes(commuteInCutoffAbsolute)
  );
  const commuteHomeCutoffLabel = formatClock(
    clockMinutes(commuteHomeCutoffAbsolute)
  );

  return {
    status,
    canCommuteIn,
    canCommuteHome,
    reportMinutes: clockMinutes(reportAbsolute),
    releaseMinutes: clockMinutes(releaseAbsolute),
    reportDayOffset,
    releaseDayOffset,
    reportLabel,
    releaseLabel,
    reasons: [
      canCommuteIn
        ? `Report ${reportLabel} meets your ${commuteInCutoffLabel} commute-in cutoff.`
        : `Report ${reportLabel} is before your ${commuteInCutoffLabel} commute-in cutoff.`,
      canCommuteHome
        ? `Release ${releaseLabel} meets your ${commuteHomeCutoffLabel} commute-home cutoff.`
        : `Release ${releaseLabel} is after your ${commuteHomeCutoffLabel} commute-home cutoff.`,
    ],
  };
}
