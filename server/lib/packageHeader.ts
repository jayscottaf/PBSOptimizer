/**
 * Extract base and aircraft from bid-package text. Two real-world shapes:
 *
 * 1. Pairings-section header (TXT extracts):
 *      "NYC BASE               220 PILOT PAIRINGS"
 * 2. PDF cover page (full bid package PDFs), where the base appears as a
 *    full city name and the aircraft code on separate lines above the
 *    "PILOT BID PACKAGE" title:
 *      "NEW YORK CITY"
 *      "220                                      July"
 *      "PILOT BID PACKAGE  2026"
 *
 * Kept free of storage/db imports so it can be unit-tested directly
 * (scripts/bid-tools-check.ts).
 */

const BASE_NAME_TO_CODE: Record<string, string> = {
  'NEW YORK CITY': 'NYC',
  'NEW YORK': 'NYC',
  ATLANTA: 'ATL',
  BOSTON: 'BOS',
  CINCINNATI: 'CVG',
  DETROIT: 'DTW',
  'LOS ANGELES': 'LAX',
  MINNEAPOLIS: 'MSP',
  'SALT LAKE CITY': 'SLC',
  SEATTLE: 'SEA',
  'SAN FRANCISCO': 'SFO',
  NEWARK: 'EWR',
};

export function extractBaseAndAircraft(
  text: string
): { base: string; aircraft: string } | null {
  const lines = text.split('\n').map(line => line.trim());
  const limit = Math.min(60, lines.length);

  // Shape 1: pairings-section header line.
  for (let i = 0; i < limit; i++) {
    const match = lines[i].match(
      /^([A-Z]{3})\s+BASE\s+([A-Z0-9]+)\s+(?:PILOT|MASTER)\s+PAIRINGS/i
    );
    if (match) {
      return {
        base: match[1].toUpperCase(),
        aircraft: match[2].toUpperCase(),
      };
    }
  }

  // Shape 2: cover page. Find the title, then scan the lines just above it
  // for a known base city name and an aircraft code at line start.
  for (let i = 0; i < limit; i++) {
    if (!/PILOT\s+BID\s+PACKAGE/i.test(lines[i])) continue;

    const windowLines = lines.slice(Math.max(0, i - 6), i + 1);
    let base: string | null = null;
    let aircraft: string | null = null;

    for (const line of windowLines) {
      const upper = line.toUpperCase();
      if (!base) {
        for (const [name, code] of Object.entries(BASE_NAME_TO_CODE)) {
          if (upper.startsWith(name)) {
            base = code;
            break;
          }
        }
      }
      if (!aircraft) {
        // Aircraft code at line start: optional letter prefix + 2-3 digits +
        // optional letter suffix ("220", "A350", "73H", "7ER").
        const match = upper.match(/^([A-Z]?\d{2,3}[A-Z]{0,2}|7ER)\b/);
        if (match) aircraft = match[1];
      }
    }

    if (base && aircraft) return { base, aircraft };
  }

  return null;
}
