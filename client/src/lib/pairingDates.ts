/**
 * Utility functions for parsing pairing effective dates and calculating valid start dates
 */

const MONTH_MAP: { [key: string]: number } = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
};

const DAY_OF_WEEK_MAP: { [key: string]: number } = {
  SU: 0, // Sunday
  MO: 1, // Monday
  TU: 2, // Tuesday
  WE: 3, // Wednesday
  TH: 4, // Thursday
  FR: 5, // Friday
  SA: 6, // Saturday
};

interface ParsedEffectiveDates {
  type: 'single' | 'range';
  startDate: Date;
  endDate?: Date;
  excludedDaysOfWeek: number[]; // 0-6 (Sun-Sat)
  excludedDates: Date[];
}

/**
 * Parse effective dates string (e.g., "OCT12 ONLY" or "OCT14-OCT.29 EXCEPT MO SA SU EXCEPT OCT 16 OCT 21 OCT 28")
 */
export function parseEffectiveDates(
  effectiveDates: string,
  year: number
): ParsedEffectiveDates | null {
  if (!effectiveDates) return null;

  const result: ParsedEffectiveDates = {
    type: 'single',
    startDate: new Date(),
    excludedDaysOfWeek: [],
    excludedDates: [],
  };

  // Check if it's a range (contains hyphen)
  // Handle formats like "OCT14-OCT.29", "OCT14-OCT. 29", "OCT14-OCT29"
  const rangeMatch = effectiveDates.match(
    /([A-Z]{3})(\d{1,2})\s*-\s*([A-Z]{3})[\.\s]*(\d{1,2})/
  );

  if (rangeMatch) {
    // Range format: OCT14-OCT.29 or OCT14-OCT. 29
    result.type = 'range';
    const startMonth = MONTH_MAP[rangeMatch[1]];
    const startDay = parseInt(rangeMatch[2]);
    const endMonth = MONTH_MAP[rangeMatch[3]];
    const endDay = parseInt(rangeMatch[4]);

    if (startMonth === undefined || endMonth === undefined) {
      return null;
    }

    result.startDate = new Date(year, startMonth, startDay);
    result.endDate = new Date(year, endMonth, endDay);
  } else {
    // Single date format: OCT12 ONLY or just OCT12
    const singleMatch = effectiveDates.match(/([A-Z]{3})(\d{1,2})/);
    if (!singleMatch) return null;

    const month = MONTH_MAP[singleMatch[1]];
    const day = parseInt(singleMatch[2]);

    if (month === undefined) {
      return null;
    }

    result.startDate = new Date(year, month, day);
  }

  // Parse EXCEPT clauses
  const exceptParts = effectiveDates.split('EXCEPT');

  for (let i = 1; i < exceptParts.length; i++) {
    const part = exceptParts[i].trim();

    // Check for day-of-week exclusions (MO, SA, SU, etc.)
    const dayOfWeekMatches = part.match(/\b(SU|MO|TU|WE|TH|FR|SA)\b/g);
    if (dayOfWeekMatches) {
      dayOfWeekMatches.forEach(dow => {
        const dayNum = DAY_OF_WEEK_MAP[dow];
        if (dayNum !== undefined && !result.excludedDaysOfWeek.includes(dayNum)) {
          result.excludedDaysOfWeek.push(dayNum);
        }
      });
    }

    // Check for specific date exclusions (OCT 16 OCT 21 OCT 28)
    const dateMatches = part.match(/([A-Z]{3})\s+(\d{1,2})/g);
    if (dateMatches) {
      dateMatches.forEach(dateStr => {
        const match = dateStr.match(/([A-Z]{3})\s+(\d{1,2})/);
        if (match) {
          const month = MONTH_MAP[match[1]];
          const day = parseInt(match[2]);
          if (month !== undefined) {
            result.excludedDates.push(new Date(year, month, day));
          }
        }
      });
    }
  }

  return result;
}

/**
 * Calculate all valid start dates for a pairing based on its effective dates
 */
export function calculateValidStartDates(
  effectiveDates: string,
  year: number,
  pairingDays: number
): Date[] {
  const parsed = parseEffectiveDates(effectiveDates, year);
  if (!parsed) return [];

  const validDates: Date[] = [];

  if (parsed.type === 'single') {
    // Single date pairing
    validDates.push(parsed.startDate);
  } else if (parsed.type === 'range' && parsed.endDate) {
    // Range pairing - iterate through all dates in range
    const current = new Date(parsed.startDate);
    const end = new Date(parsed.endDate);

    while (current <= end) {
      const currentDay = current.getDay();

      // Check if this day of week is excluded
      if (!parsed.excludedDaysOfWeek.includes(currentDay)) {
        // Check if this specific date is excluded
        const isDateExcluded = parsed.excludedDates.some(excludedDate => {
          return (
            excludedDate.getFullYear() === current.getFullYear() &&
            excludedDate.getMonth() === current.getMonth() &&
            excludedDate.getDate() === current.getDate()
          );
        });

        if (!isDateExcluded) {
          validDates.push(new Date(current));
        }
      }

      // Move to next day
      current.setDate(current.getDate() + 1);
    }
  }

  return validDates;
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
  preferredDaysOff: Date[]
): boolean {
  const validStartDates = calculateValidStartDates(
    effectiveDates,
    year,
    pairingDays
  );

  const normalizeDate = (date: Date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  const daysOffTimestamps = preferredDaysOff.map(normalizeDate);

  // Debug logging - log first 3 pairings checked + any that contain "OCT14" or "OCT29"
  if (!window.__rangePairingLogCount) {
    window.__rangePairingLogCount = 0;
  }
  const isDebugWorthy = window.__rangePairingLogCount < 3 ||
                        effectiveDates.includes('OCT14') ||
                        effectiveDates.includes('OCT29');

  if (isDebugWorthy && window.__rangePairingLogCount < 10) {
    console.log(`Pairing Check #${window.__rangePairingLogCount + 1} (${effectiveDates}):`, {
      effectiveDates,
      pairingDays,
      validStartDatesCount: validStartDates.length,
      validStartDates: validStartDates.slice(0, 5).map(d => d.toDateString()),
      preferredDaysOff: preferredDaysOff.map(d => d.toDateString())
    });
    window.__rangePairingLogCount++;
  }

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
