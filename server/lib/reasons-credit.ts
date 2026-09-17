import { printedDurationHours } from '../../shared/durations';

export function parseReasonsCredits(
  pairingNumber: string,
  monthCredit: string,
  totalCredit: string
): { creditHours: number; totalCredit: number | null } {
  const creditHours = printedDurationHours(monthCredit);
  if (!Number.isFinite(creditHours)) {
    throw new Error(`Invalid credit for pairing ${pairingNumber}`);
  }

  const parsedTotalCredit = printedDurationHours(totalCredit);
  return {
    creditHours,
    totalCredit: Number.isFinite(parsedTotalCredit) ? parsedTotalCredit : null,
  };
}
