/**
 * Client-side derivations of PBS pairing properties, used by the dashboard's
 * client-side re-filter path (which re-filters from the full local cache
 * whenever a sort column or Days Off filter is active, instead of re-hitting
 * the server).
 *
 * These MUST match the server's semantics: the SQL filter fragments in
 * server/storage.ts getAllPairingsForBidPackage and the JS reference
 * implementations in server/lib/bidSimulator.ts (layoverHours,
 * parseCheckInHour, toSimPairing). If you change one, change all three.
 */

function asArray(value: unknown): any[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Number of overnight layovers. NAVBLUE "Number Of Layovers". */
export function layoverCount(pairing: any): number {
  return asArray(pairing?.layovers).length;
}

/** Sum of layover durations ("HH.MM" strings) in decimal hours. */
export function totalLayoverHours(pairing: any): number {
  let minutes = 0;
  for (const l of asArray(pairing?.layovers)) {
    const str = String(l?.duration ?? '').trim();
    if (!str) {
      continue;
    }
    const [h, m] = str.split('.');
    minutes +=
      (parseInt(h || '0', 10) || 0) * 60 +
      (parseInt((m || '0').padEnd(2, '0').slice(0, 2), 10) || 0);
  }
  return minutes / 60;
}

/** Check-in hour of day (0-23) or null when unparseable. */
export function checkInHour(pairing: any): number | null {
  const raw = pairing?.checkInTime;
  if (!raw) {
    return null;
  }
  const text = String(raw).trim();
  // Formats seen in the data: "10.35" (HH.MM), "05:00", "0500", bare hour
  const dotted = text.match(/^(\d{1,2})[.:](\d{2})$/);
  if (dotted) {
    return parseInt(dotted[1], 10);
  }
  const compact = text.match(/^(\d{2})(\d{2})$/);
  if (compact) {
    return parseInt(compact[1], 10);
  }
  const bare = parseInt(text, 10);
  return Number.isNaN(bare) ? null : Math.min(23, bare);
}

/** First flight segment's departure airport, uppercased, or null. */
export function checkInStation(pairing: any): string | null {
  const segments = asArray(pairing?.flightSegments);
  if (segments.length === 0) {
    return null;
  }
  const station = String(segments[0]?.departure ?? '').toUpperCase();
  return station || null;
}

/** True when any leg departs between 22:00 and 04:59. */
export function hasRedeye(pairing: any): boolean {
  return asArray(pairing?.flightSegments).some((s: any) => {
    const m = String(s?.departureTime ?? '').match(/^(\d{2})/);
    if (!m) {
      return false;
    }
    const hour = parseInt(m[1], 10);
    return hour >= 22 || hour < 5;
  });
}

/** Uppercased layover city list for include/exclude checks. */
export function layoverCities(pairing: any): string[] {
  return asArray(pairing?.layovers)
    .map((l: any) => String(l?.city ?? '').toUpperCase())
    .filter(Boolean);
}
