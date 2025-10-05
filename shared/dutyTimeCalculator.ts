/**
 * Calculate actual duty start and end times from pairing data
 * FAA rest rules are based on DUTY TIME, not calendar days
 */

export interface FlightSegment {
  date: string; // Day letter: A, B, C, etc.
  departureTime: string; // HHMM format
  arrivalTime: string; // HHMM format
  departure: string;
  arrival: string;
  isDeadhead?: boolean;
}

/**
 * Convert HHMM string to hours and minutes
 */
function parseTime(timeStr: string): { hours: number; minutes: number } {
  const hours = parseInt(timeStr.substring(0, 2), 10);
  const minutes = parseInt(timeStr.substring(2, 4), 10);
  return { hours, minutes };
}

/**
 * Convert day letter to day offset (A=0, B=1, C=2, etc.)
 */
function dayLetterToOffset(dayLetter: string): number {
  return dayLetter.charCodeAt(0) - 'A'.charCodeAt(0);
}

/**
 * Calculate duty start time (report time = first departure - 1 hour)
 */
export function calculateDutyStartTime(
  baseDate: Date,
  firstSegment: FlightSegment
): Date {
  const { hours, minutes } = parseTime(firstSegment.departureTime);
  const dayOffset = dayLetterToOffset(firstSegment.date);

  const dutyStart = new Date(baseDate);
  dutyStart.setDate(dutyStart.getDate() + dayOffset);
  dutyStart.setHours(hours, minutes, 0, 0);

  // Report time is 1 hour before departure
  dutyStart.setHours(dutyStart.getHours() - 1);

  return dutyStart;
}

/**
 * Calculate duty end time (release time = last arrival + 30 minutes)
 */
export function calculateDutyEndTime(
  baseDate: Date,
  lastSegment: FlightSegment
): Date {
  const { hours, minutes } = parseTime(lastSegment.arrivalTime);
  const dayOffset = dayLetterToOffset(lastSegment.date);

  const dutyEnd = new Date(baseDate);
  dutyEnd.setDate(dutyEnd.getDate() + dayOffset);
  dutyEnd.setHours(hours, minutes, 0, 0);

  // Release time is 30 minutes after arrival
  dutyEnd.setMinutes(dutyEnd.getMinutes() + 30);

  return dutyEnd;
}

/**
 * Calculate rest hours between two pairings
 */
export function calculateRestHours(
  firstPairingEnd: Date,
  secondPairingStart: Date
): number {
  const milliseconds = secondPairingStart.getTime() - firstPairingEnd.getTime();
  return milliseconds / (1000 * 60 * 60);
}
