/**
 * A pilot's line from an uploaded wide schedule, turned into calendar
 * entries: trips plus training, reserve and vacation blocks.
 */
import type { CalendarEntryKind } from '@shared/schema';

export interface LineCalendarItem {
  kind: CalendarEntryKind;
  code: string;
  /** Day of the report's month (0 = previous month's last day, 32 = the
   * next month's 1st in a 31-day month). */
  day: number;
  endDay: number;
  startTime: string | null;
  releaseTime: string | null;
  creditHours: number | null;
  pairingId: number | null;
}

export interface LineForCalendar {
  month: string;
  year: number;
  monthNumber: number;
  category: string;
  seniority: number;
  bidPackageFound: boolean;
  items: LineCalendarItem[];
}

export const CALENDAR_KIND_LABELS: Record<CalendarEntryKind, string> = {
  pairing: 'Trip',
  training: 'Training',
  reserve: 'Reserve',
  vacation: 'Vacation',
  other: 'Event',
};

const clock = (value: string | null, fallback: [number, number]) => {
  const m = value?.match(/^(\d{2}):(\d{2})$/);
  return m ? [Number(m[1]), Number(m[2])] : fallback;
};

/**
 * Local start/end of an item. Times on the report are base-local, and the
 * browser is the pilot's, so dates are built locally (as Add to Calendar
 * does). Days past the month's end roll into the next month (Date does
 * that natively: Dec 32 is Jan 1).
 */
export function lineItemTimes(
  item: LineCalendarItem,
  line: Pick<LineForCalendar, 'year' | 'monthNumber'>
): { start: Date; end: Date } {
  const [sh, sm] = clock(item.startTime, [0, 0]);
  const [eh, em] = clock(item.releaseTime, [23, 59]);
  return {
    start: new Date(line.year, line.monthNumber - 1, item.day, sh, sm),
    end: new Date(line.year, line.monthNumber - 1, item.endDay, eh, em),
  };
}

/** Calendar title: "10WD" for activities, "Trip 8085" for an unlinked trip. */
export function lineItemTitle(item: LineCalendarItem): string {
  return item.kind === 'pairing' ? `Trip ${item.code}` : item.code;
}

const SHORT = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

/** "Fri, Dec 4 18:59 – Sun, Dec 6 13:38" */
export function describeLineItemWhen(
  item: LineCalendarItem,
  line: Pick<LineForCalendar, 'year' | 'monthNumber'>
): string {
  const { start, end } = lineItemTimes(item, line);
  const sameDay = start.toDateString() === end.toDateString();
  const startText = `${SHORT.format(start)}${item.startTime ? ` ${item.startTime}` : ''}`;
  const endText =
    `${sameDay ? '' : `${SHORT.format(end)} `}${item.releaseTime ?? ''}`.trim();
  return endText ? `${startText} – ${endText}` : startText;
}
