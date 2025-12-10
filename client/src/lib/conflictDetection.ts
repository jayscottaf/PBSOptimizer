import { parse, addDays, isBefore, isAfter } from 'date-fns';

export interface ConflictInfo {
  pairingId: number;
  conflicts: Array<{
    calendarPairingNumber: string;
    calendarStartDate: string;
    calendarEndDate: string;
  }>;
}

/**
 * Parse pairing effective dates and calculate date range
 * Handles formats like "JAN01-JAN03", "JAN4 SU", "EFFECTIVE JAN 01 - JAN 31"
 */
export function parsePairingDateRange(
  effectiveDates: string,
  year: number,
  pairingDays: number = 1
): { startDate: Date; endDate: Date } | null {
  if (!effectiveDates) return null;

  try {
    const upperDates = effectiveDates.toUpperCase();
    
    // Try to extract date tokens like "JAN01", "JAN 01", "01JAN"
    const dateRegex = /\b((?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*\d{1,2}|\d{1,2}\s*(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC))\b/gi;
    const matches = Array.from(upperDates.matchAll(dateRegex)).map(m => m[1].replace(/\s+/g, ''));

    if (matches.length === 0) return null;

    const parseDate = (token: string): Date | null => {
      // Normalize to "MONdd" format
      const match = token.match(/^(?:([A-Z]{3})(\d{1,2})|(\d{1,2})([A-Z]{3}))$/i);
      if (!match) return null;

      const month = (match[1] || match[4])?.toUpperCase();
      const day = parseInt(match[2] || match[3], 10);

      if (!month || isNaN(day)) return null;

      const dateStr = `${month}${day.toString().padStart(2, '0')}${year}`;
      const parsed = parse(dateStr, 'MMMddyyyy', new Date());
      
      return isNaN(parsed.getTime()) ? null : parsed;
    };

    const startDate = parseDate(matches[0]);
    if (!startDate) return null;

    // If we have two dates, use the second as end date
    // Otherwise, calculate end date based on pairingDays
    let endDate: Date;
    if (matches.length >= 2) {
      const parsedEnd = parseDate(matches[1]);
      endDate = parsedEnd || addDays(startDate, pairingDays - 1);
    } else {
      // Calculate end date from pairingDays
      endDate = addDays(startDate, pairingDays - 1);
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

  if (!calendarEvents || calendarEvents.length === 0) {
    return conflicts;
  }

  // Build a map of calendar pairings with their date ranges
  const calendarPairingDateMap = new Map<
    number,
    { startDate: Date; endDate: Date; pairingNumber: string }
  >();

  calendarEvents.forEach(event => {
    if (!event.startDate || !event.endDate) return;
    
    const startDate = new Date(event.startDate);
    const endDate = new Date(event.endDate);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return;

    // Get pairing number from different possible locations
    const pairingNumber = event.pairing?.pairingNumber || event.pairingNumber || `Pairing ${event.pairingId}`;
    
    console.log(`Calendar event for pairing ${event.pairingId}:`, {
      pairingNumber,
      startDate,
      endDate,
      eventPairingNumber: event.pairing?.pairingNumber,
      eventDirectNumber: event.pairingNumber,
    });

    calendarPairingDateMap.set(event.pairingId, {
      startDate,
      endDate,
      pairingNumber,
    });
  });

  if (calendarPairingDateMap.size === 0) {
    return conflicts;
  }

  // Check each search result pairing for conflicts
  searchPairings.forEach(pairing => {
    // Skip if this pairing is already in calendar (can't conflict with itself)
    if (calendarPairingDateMap.has(pairing.id)) {
      return;
    }

    const pairingDates = parsePairingDateRange(
      pairing.effectiveDates,
      bidPackageYear,
      pairing.pairingDays || 1
    );

    if (!pairingDates) {
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
          calendarStartDate: calendarDates.startDate.toISOString().split('T')[0],
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
