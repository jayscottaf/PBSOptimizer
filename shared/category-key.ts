/** Match display names (A330) and report category codes (330-B). */
export function categoryKey(base: string, aircraft: string, position: string) {
  const normalized = aircraft.toUpperCase().replace(/\s+/g, '');
  const suffix = normalized.match(/-?([AB])$/)?.[1];
  const fleet = normalized
    .replace(/-?[AB]$/, '')
    .replace(/^[A-Z](\d{3})$/, '$1');
  return `${base.trim().toUpperCase()}|${fleet}|${suffix || position}`;
}

/** The viewed package chooses the fleet; a bare fleet inherits the pilot's seat. */
export function analysisCategory(
  base: string,
  aircraft: string,
  savedAircraft: string,
  savedPosition?: string
) {
  const savedSeat = savedAircraft.toUpperCase().match(/-?([AB])$/)?.[1];
  const [categoryBase, fleet, seat] = categoryKey(
    base,
    aircraft,
    savedPosition || savedSeat || 'B'
  ).split('|');
  return { base: categoryBase, aircraft: fleet, position: seat as 'A' | 'B' };
}
