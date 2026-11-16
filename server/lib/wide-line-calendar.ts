/**
 * Turns one pilot's line from a NAVBLUE wide schedule into calendar items:
 * trips (linked to the bid package's pairing when it is uploaded) and
 * everything else on the line — training ("10WD"), reserve, vacation.
 * Pure so it can be tested without a database.
 */
import type { CalendarEntryKind } from '../../shared/schema';
import type { WideScheduleEvent } from '../wideScheduleParser';

export interface CalendarLineItem {
  kind: CalendarEntryKind;
  /** Pairing number or activity code as printed ("8085", "10WD", "RES"). */
  code: string;
  /** Day of the period month the item starts/ends (0 = last day of the
   * previous month, 32 = Jan 1 in a December report). */
  day: number;
  endDay: number;
  /** Local base times as printed; null when the report shows none. */
  startTime: string | null;
  releaseTime: string | null;
  creditHours: number | null;
  /** Bid-package pairing this trip matches; null when not found. */
  pairingId: number | null;
}

const WHOLE_DAY_START = '00:00';
const WHOLE_DAY_END = '23:59';

const kindOf = (event: WideScheduleEvent): CalendarEntryKind =>
  event.type === 'pairing'
    ? 'pairing'
    : event.type === 'training' ||
        event.type === 'reserve' ||
        event.type === 'vacation'
      ? event.type
      : 'other';

export function buildLineCalendarItems(
  events: WideScheduleEvent[],
  resolvePairingId: (code: string, day: number) => number | null
): CalendarLineItem[] {
  const items: CalendarLineItem[] = [];
  for (const event of [...events].sort((a, b) => a.day - b.day)) {
    const item: CalendarLineItem = {
      kind: kindOf(event),
      code: event.code,
      day: event.day,
      endDay: event.endDay ?? event.day,
      startTime: event.checkInTime ?? null,
      releaseTime: event.releaseTime ?? null,
      creditHours: event.creditHours ?? null,
      pairingId:
        event.type === 'pairing'
          ? resolvePairingId(event.code, event.day)
          : null,
    };
    // Reserve and vacation print one whole-day block per day; show a run of
    // consecutive days as one entry instead of a stack of single days.
    const previous = items[items.length - 1];
    if (
      previous &&
      item.kind !== 'pairing' &&
      previous.kind === item.kind &&
      previous.code === item.code &&
      previous.endDay + 1 === item.day &&
      previous.releaseTime === WHOLE_DAY_END &&
      item.startTime === WHOLE_DAY_START
    ) {
      previous.endDay = item.endDay;
      previous.releaseTime = item.releaseTime;
      if (item.creditHours !== null) {
        previous.creditHours = (previous.creditHours ?? 0) + item.creditHours;
      }
      continue;
    }
    items.push(item);
  }
  return items;
}
