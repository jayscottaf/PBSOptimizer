/** Printed PBS durations use hours and minutes, never decimal fractions. */
export function printedDurationMinutes(
  value: string | number | null | undefined
): number {
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d+)(?:[.:]([0-5]\d))?$/);
  if (!match) return NaN;
  return Number(match[1]) * 60 + Number(match[2] ?? 0);
}

/** Database credit/block fields and filter inputs explicitly use decimal hours. */
export function decimalHoursToMinutes(value: string | number): number {
  const hours = Number(value);
  return Number.isFinite(hours) && hours >= 0 ? Math.round(hours * 60) : NaN;
}

export function printedDurationHours(value: string | number): number {
  return printedDurationMinutes(value) / 60;
}

export function formatDuration(
  minutes: number,
  separator: '.' | ':' = '.'
): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '—';
  const rounded = Math.round(minutes);
  return `${Math.floor(rounded / 60)}${separator}${String(rounded % 60).padStart(2, '0')}`;
}
