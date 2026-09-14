/** Match display names (A330) and report category codes (330-B). */
export function categoryKey(base: string, aircraft: string, position: string) {
  const normalized = aircraft.toUpperCase().replace(/\s+/g, '');
  const suffix = normalized.match(/-?([AB])$/)?.[1];
  const fleet = normalized
    .replace(/-?[AB]$/, '')
    .replace(/^[A-Z](\d{3})$/, '$1');
  return `${base.trim().toUpperCase()}|${fleet}|${suffix || position}`;
}
