/**
 * Departures of one trip are at least a day apart, so an existing calendar
 * entry starting within this window of a new one is the same departure.
 */
export const SAME_DEPARTURE_MS = 12 * 60 * 60 * 1000;

/**
 * The calendar entry for the same departure of a trip, if any. A trip that
 * departs several times can be on the calendar once per departure; only a
 * re-add of the same departure updates an entry in place (refreshing its
 * duty times) instead of adding another.
 */
export function findSameDeparture<T extends { startDate: Date }>(
  entries: T[],
  startDate: Date
): T | undefined {
  return entries.find(
    entry =>
      Math.abs(entry.startDate.getTime() - startDate.getTime()) <
      SAME_DEPARTURE_MS
  );
}
