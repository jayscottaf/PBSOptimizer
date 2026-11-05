import { isBefore, isAfter } from 'date-fns';
import { calculateValidStartDates } from './pairingDates';

export interface ConflictInfo {
  pairingId: number;
  conflicts: Array<{
    calendarPairingNumber: string;
    calendarStartDate: string;
    calendarEndDate: string;
  }>;
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
 * Detect which search result pairings conflict with calendar items.
 *
 * A pairing conflicts when at least one of its real departures (the dates it
 * actually flies, from shared/operatingDates) overlaps a calendar item. The
 * effective range alone is not enough: a "TU TH SA" trip spanning the month
 * would otherwise collide with every item in the month, including days it
 * never operates.
 */
export function detectConflicts(
  searchPairings: any[],
  calendarEvents: any[],
  bidPackageYear: number,
  bidPackageMonth?: string | number | null
): Map<number, ConflictInfo> {
  const conflicts = new Map<number, ConflictInfo>();

  if (!calendarEvents || calendarEvents.length === 0) {
    return conflicts;
  }

  const calendarItems: Array<{
    pairingId: number;
    startDate: Date;
    endDate: Date;
    pairingNumber: string;
  }> = [];
  calendarEvents.forEach(event => {
    if (!event.startDate || !event.endDate) return;
    const startDate = new Date(event.startDate);
    const endDate = new Date(event.endDate);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return;
    calendarItems.push({
      pairingId: event.pairingId,
      startDate,
      endDate,
      pairingNumber:
        event.pairing?.pairingNumber ||
        event.pairingNumber ||
        `Pairing ${event.pairingId}`,
    });
  });

  if (calendarItems.length === 0) {
    return conflicts;
  }
  const onCalendar = new Set(calendarItems.map(item => item.pairingId));

  searchPairings.forEach(pairing => {
    // A pairing already on the calendar can't conflict with itself.
    if (onCalendar.has(pairing.id)) {
      return;
    }

    const days = Math.max(1, Number(pairing.pairingDays) || 1);
    const instances = calculateValidStartDates(
      pairing.effectiveDates,
      bidPackageYear,
      days,
      {
        operatingDows: pairing.operatingDows,
        exceptDates: pairing.exceptDates,
      },
      bidPackageMonth
    ).map(start => {
      // Whole duty days: through the end of the trip's last day.
      const end = new Date(start);
      end.setDate(end.getDate() + days - 1);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    });
    if (instances.length === 0) {
      return;
    }

    const pairingConflicts: ConflictInfo['conflicts'] = [];
    for (const item of calendarItems) {
      if (
        instances.some(instance =>
          dateRangesOverlap(
            instance.start,
            instance.end,
            item.startDate,
            item.endDate
          )
        )
      ) {
        pairingConflicts.push({
          calendarPairingNumber: item.pairingNumber,
          calendarStartDate: item.startDate.toISOString().split('T')[0],
          calendarEndDate: item.endDate.toISOString().split('T')[0],
        });
      }
    }

    if (pairingConflicts.length > 0) {
      conflicts.set(pairing.id, {
        pairingId: pairing.id,
        conflicts: pairingConflicts,
      });
    }
  });

  return conflicts;
}
