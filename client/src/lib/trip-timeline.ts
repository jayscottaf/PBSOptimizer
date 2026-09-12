export interface TimelineSegment {
  date?: string;
  day?: string;
  flightNumber?: string;
  departure?: string;
  arrival?: string;
  departureTime?: string;
  arrivalTime?: string;
  blockTime?: string;
  isDeadhead?: boolean;
}

/** Keep the printed day offsets: A/C is day 1/3, including trips beyond G. */
export function groupTripDays(segments: TimelineSegment[]) {
  const groups = new Map<string, TimelineSegment[]>();
  for (const segment of segments) {
    const raw = String(segment.date || segment.day || '').toUpperCase();
    const day = /^[A-Z]$/.test(raw) ? raw : '?';
    groups.set(day, [...(groups.get(day) ?? []), segment]);
  }
  return Array.from(groups, ([letter, flights]) => ({
    letter,
    day: letter === '?' ? null : letter.charCodeAt(0) - 64,
    flights,
  })).sort((a, b) => (a.day ?? Infinity) - (b.day ?? Infinity));
}

export function formatFlightTime(value?: string): string {
  const match = String(value ?? '').match(/^(\d{2})[.:]?(\d{2})$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59)
    return value || '—';
  return `${match[1]}:${match[2]}`;
}
