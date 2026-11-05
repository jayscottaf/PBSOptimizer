/**
 * Consistency checks for one parsed pairing block.
 *
 * The parser used to degrade silently: a trip without a readable EFFECTIVE
 * range was given a guessed month, extra layovers were dropped, and day
 * letters past J were never read. These checks name each problem so an
 * upload reports which trips need review instead of storing a guess as
 * fact. Pure (no storage) so it can be unit-tested directly.
 */

/** Day letters the parser reads: A..N is a 14-day trip. */
export const MAX_PAIRING_DAYS = 14;

export interface PairingParseFacts {
  effectiveDates: string;
  pairingDays: number;
  operatingDows?: number[] | null;
  exceptDates?: string[] | null;
  /** Distinct layover cities found before trimming to pairingDays - 1. */
  layoversFound: number;
}

export interface PairingParseWarning {
  pairingNumber: string;
  message: string;
}

/** "TAFB  100.53" (printed hours.minutes) -> hours. */
function printedTafbHours(block: string): number | null {
  const m = block.match(/TAFB\s+(\d{1,3})\.(\d{2})\b/);
  return m ? parseInt(m[1], 10) + parseInt(m[2], 10) / 60 : null;
}

export function checkParsedPairing(
  block: string,
  facts: PairingParseFacts
): string[] {
  const warnings: string[] = [];
  const header = block.split('\n')[0] ?? '';

  if (!facts.effectiveDates) {
    warnings.push(
      'No EFFECTIVE date range found, so the trip has no operating dates.'
    );
  }

  const beyondSupported = block.match(/^\s*([O-Z])\s+(?:DH\s+)?\*?\d{3,4}\s/m);
  if (beyondSupported) {
    warnings.push(
      `Day letter ${beyondSupported[1]} is past the supported ${MAX_PAIRING_DAYS}-day limit; later days were not read.`
    );
  }

  const tafb = printedTafbHours(block);
  if (tafb !== null && tafb > 0) {
    // A trip spanning N calendar days is away at least (N-2) full days and
    // at most N days, so TAFB pins the day count to one of two values.
    const minDays = Math.max(1, Math.ceil(tafb / 24));
    if (facts.pairingDays < minDays || facts.pairingDays > minDays + 1) {
      warnings.push(
        `Trip length (${facts.pairingDays} days) disagrees with TAFB ${tafb.toFixed(1)}h; day letters may be misread.`
      );
    }
  }

  if (/\bEXCPT\b/.test(header) && !facts.operatingDows) {
    warnings.push(
      'The EXCPT weekday clause could not be read, so every weekday in the range is treated as operating.'
    );
  }
  if (/\bEXCEPT\b/.test(block) && (facts.exceptDates?.length ?? 0) === 0) {
    warnings.push(
      'An EXCEPT clause is present but no skipped dates could be read from it.'
    );
  }

  const maxLayovers = Math.max(0, facts.pairingDays - 1);
  if (facts.layoversFound > maxLayovers) {
    warnings.push(
      `Found ${facts.layoversFound} layover cities for a ${facts.pairingDays}-day trip; only ${maxLayovers} were kept.`
    );
  }

  return warnings;
}
