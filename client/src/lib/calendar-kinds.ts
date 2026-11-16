import type { CalendarEntryKind } from '@shared/schema';

/** One color per calendar entry kind, shared by the calendar and previews. */
export const CALENDAR_KIND_STYLES: Record<
  CalendarEntryKind,
  { bar: string; chip: string }
> = {
  pairing: { bar: 'bg-blue-600', chip: 'bg-blue-600' },
  training: { bar: 'bg-slate-600', chip: 'bg-slate-600' },
  reserve: { bar: 'bg-amber-600', chip: 'bg-amber-600' },
  vacation: { bar: 'bg-emerald-600', chip: 'bg-emerald-600' },
  other: { bar: 'bg-violet-600', chip: 'bg-violet-600' },
};
