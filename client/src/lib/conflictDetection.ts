import { parse, isWithinInterval, isBefore, isAfter } from 'date-fns';

export interface ConflictInfo {
  pairingId: number;
  conflicts: Array<{
    calendarPairingNumber: string;
    calendarStartDate: string;
    calendarEndDate: string;
  }>;
}

/**
 * Parse pairing effective dates (e.g., "JAN01-JAN03")
 * This handles date ranges in the format "MONdd-MONdd"
 */
export function parsePairingDateRange(
  effectiveDates: string,
  year: number
): { startDate: Date; endDate: Date } | null {
  if (!effectiveDates) return null;

  try {
    // Extract date tokens like "JAN01" or "01JAN"
    const dateRegex =
      /\b((?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*\d{1,2}|\d{1,2}\s*(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC))\b/g;
    const matches = Array.from(effectiveDates.matchAll(dateRegex)).map(
      m => m[1]
    );

    if (matches.length < 2) return null;

    const parseDate = (token: string): Date => {
      // Normalize to "MONdd" format
      const match = token.match(
        /^(?:([A-Z]{3})\s*(\d{1,2})|(\d{1,2})\s*([A-Z]{3}))$/
      );
      if (!match) throw new Error(`Cannot parse date token: ${token}`);

      const month = (match[1] || match[4]) as string;
      const day = parseInt(match[2] || match[3], 10);

      const dateStr = `${month}${day}${year}`;
      return parse(dateStr, 'MMMddyyyy', new Date());
    };

    const startDate = parseDate(matches[0]);
    const endDate = parseDate(matches[1]);

    // Validate parsed dates
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return null;
    }

    return { startDate, endDate };
  } catch (error) {
    console.warn(`Failed to parse pairing dates: ${effectiveDates}`, error);
    return null;
  }
}

/**
 * Check if two date ranges overlap
 */
export function dateRangesOverlap(
  range1Start: Date,
  range1End: Date,
  range2Start: Date,
  range2End: Date
): boolean {
  // Ranges overlap if neither is completely before or after the other
  return !isBefore(range1End, range2Start) && !isAfter(range1Start, range2End);
}

/**
 * Detect which search result pairings conflict with calendar items
 */
export function detectConflicts(
  searchPairings: any[],
  calendarEvents: any[],
  bidPackageYear: number
): Map<number, ConflictInfo> {
  const conflicts = new Map<number, ConflictInfo>();

  // Build a map of calendar pairings with their date ranges
  const calendarPairingDateMap = new Map<
    number,
    { startDate: Date; endDate: Date; pairingNumber: string }
  >();

  calendarEvents.forEach(event => {
    const startDate = new Date(event.startDate);
    const endDate = new Date(event.endDate);

    calendarPairingDateMap.set(event.pairingId, {
      startDate,
      endDate,
      pairingNumber: event.pairing?.pairingNumber || 'Unknown',
    });
  });

  // Check each search result pairing for conflicts
  searchPairings.forEach(pairing => {
    const pairingDates = parsePairingDateRange(
      pairing.effectiveDates,
      bidPackageYear
    );

    if (!pairingDates) {
      // If we can't parse dates, assume no conflict
      return;
    }

    const pairingConflicts: ConflictInfo['conflicts'] = [];

    // Check against all calendar pairings
    calendarPairingDateMap.forEach((calendarDates, calendarPairingId) => {
      if (
        dateRangesOverlap(
          pairingDates.startDate,
          pairingDates.endDate,
          calendarDates.startDate,
          calendarDates.endDate
        )
      ) {
        pairingConflicts.push({
          calendarPairingNumber: calendarDates.pairingNumber,
          calendarStartDate: calendarDates.startDate
            .toISOString()
            .split('T')[0],
          calendarEndDate: calendarDates.endDate.toISOString().split('T')[0],
        });
      }
    });

    if (pairingConflicts.length > 0) {
      conflicts.set(pairing.id, {
        pairingId: pairing.id,
        conflicts: pairingConflicts,
      });
    }
  });

  return conflicts;
}
