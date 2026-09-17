import { printedDurationHours } from '../../shared/durations';
import type { BidCategoryParameters } from '../../shared/bid-package-parameters';

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
