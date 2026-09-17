import { printedDurationHours } from '../../shared/durations';
import type {
  BidCategoryParameters,
  CarryOutCreditAllocation,
} from '../../shared/bid-package-parameters';

const hours = (hour: string, minute: string) =>
  printedDurationHours(`${hour}:${minute}`);

/** Parse the monthly ALV/category table printed near the front of a bid package. */
export function parseBidCategoryParameters(
  text: string
): BidCategoryParameters[] {
  const rows: BidCategoryParameters[] = [];
  const rowPattern =
    /^([A-Z]{2,3})\s+([A-Z0-9-]+)\s+([A-Z]{1,2})\s+(\d{1,3})[:.](\d{2})\s+(\d{1,3})[:.](\d{2})\s*-\s*(\d{1,3})[:.](\d{2})\s+(\d{1,3})[:.](\d{2})\s+(\d+)-(\d+)-(\d+)\s+(Yes|No)\s+(\d+)\s*$/i;

  for (const rawLine of text.split('\n')) {
    const match = rawLine.trim().match(rowPattern);
    if (!match) continue;
    const [
      ,
      base,
      aircraft,
      position,
      alvHour,
      alvMinute,
      lowHour,
      lowMinute,
      highHour,
      highMinute,
      guaranteeHour,
      guaranteeMinute,
      reserveMin,
      reserveMax,
      reserveBlocks,
      extraXDay,
      rllLimit,
    ] = match;
    const sharedExtraEligibility = extraXDay.toLowerCase() === 'yes';

    rows.push({
      base: base.toUpperCase(),
      aircraft: aircraft.toUpperCase(),
      position: position.toUpperCase(),
      alvHours: hours(alvHour, alvMinute),
      lineConstructionMinHours: hours(lowHour, lowMinute),
      lineConstructionMaxHours: hours(highHour, highMinute),
      reserveGuaranteeHours: hours(guaranteeHour, guaranteeMinute),
      reserveRule: `${reserveMin}-${reserveMax}-${reserveBlocks}`,
      extraXDay: sharedExtraEligibility,
      vacationSlide: sharedExtraEligibility,
      rllLimit: Number(rllLimit),
      displayName: `${base.toUpperCase()} ${aircraft.toUpperCase()} ${position.toUpperCase()}`,
    });
  }

  return rows;
}

/** Parse the trip carry-out credit report, retaining the departure-date split. */
export function parseCarryOutCreditAllocations(
  text: string
): CarryOutCreditAllocation[] {
  const allocations: CarryOutCreditAllocation[] = [];
  let base = '';
  let aircraft = '';
  const rowPattern =
    /^([A-Z]?\d{3,5})\s+[A-Z]{1,2}(?:\s+DH)?\s+\d{3,4}\s+(\d{2}\/\d{2})\s+\d{2}:\d{2}(?:\s+DH)?\s+\d{3,4}\s+(\d{2}\/\d{2})\s+\d{2}:\d{2}\s+\d{3}:\d{2}\s+(\d{2}):(\d{2})\s+(\d{2}):(\d{2})\s+(\d{2}):(\d{2})\s*$/;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    const baseMatch = line.match(/^BASE\s*:\s*([A-Z]{3})\b/i);
    if (baseMatch) {
      base = baseMatch[1].toUpperCase();
      continue;
    }
    const aircraftMatch = line.match(/^EQP\s*:\s*([A-Z0-9-]+)\b/i);
    if (aircraftMatch) {
      aircraft = aircraftMatch[1].toUpperCase();
      continue;
    }
    const match = line.match(rowPattern);
    if (!match || !base || !aircraft) continue;
    allocations.push({
      base,
      aircraft,
      pairingNumber: match[1],
      departureDate: match[2],
      arrivalDate: match[3],
      totalCreditHours: hours(match[4], match[5]),
      currentMonthCreditHours: hours(match[6], match[7]),
      carryOutCreditHours: hours(match[8], match[9]),
    });
  }

  return allocations;
}

export function attachCarryOutCreditAllocations(
  rows: BidCategoryParameters[],
  allocations: CarryOutCreditAllocation[]
): BidCategoryParameters[] {
  return rows.map(row => {
    const matches = allocations.filter(
      allocation =>
        allocation.base === row.base && allocation.aircraft === row.aircraft
    );
    return matches.length > 0
      ? { ...row, carryOutCreditAllocations: matches }
      : row;
  });
}
