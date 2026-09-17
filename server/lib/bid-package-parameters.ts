import { printedDurationHours } from '../../shared/durations';
import type {
  BidCategoryParameters,
  CarryOutCreditAllocation,
  CommutabilitySummary,
  MarketChangesSummary,
  TripSupplySummary,
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

interface PublishedFleetAnalytics {
  aircraft: string;
  position?: string;
  base?: string;
  commutability?: CommutabilitySummary;
  marketChanges?: MarketChangesSummary;
}

const normalizePublishedFleet = (value: string) => {
  const fleet = value.toUpperCase().replace(/^B-/, '');
  if (fleet === '757/7ER') return '7ER';
  return fleet;
};

/** Parse the official trip-length table near the end of a bid package. */
export function parsePublishedTripSupply(text: string): Array<{
  base: string;
  aircraft: string;
  position: string;
  tripSupply: TripSupplySummary;
}> {
  const results: Array<{
    base: string;
    aircraft: string;
    position: string;
    tripSupply: TripSupplySummary;
  }> = [];
  let aircraft = '';
  let base = '';
  let pending:
    | {
        base: string;
        aircraft: string;
        position: string;
        counts: number[];
        totalTrips: number;
        averageTripDays: number;
        tripPercents?: number[];
      }
    | undefined;

  for (const rawLine of text.split('\n')) {
    if (!rawLine.includes('|')) continue;
    const cells = rawLine
      .split('|')
      .slice(1, -1)
      .map(cell => cell.trim());
    if (cells.length < 5) continue;

    if (cells[0]) aircraft = normalizePublishedFleet(cells[0]);
    if (cells[1]) base = cells[1].toUpperCase();
    const label = cells[3];

    if (label === '# Trips') {
      const position = cells[2] === 'CA' ? 'A' : cells[2] === 'FO' ? 'B' : '';
      const values = cells.slice(4).map(value => Number(value));
      if (!aircraft || !base || !position || values.length < 16) continue;
      pending = {
        base,
        aircraft,
        position,
        counts: values.slice(0, 14),
        totalTrips: values[14],
        averageTripDays: values[15],
      };
      continue;
    }

    if (!pending) continue;
    const percentages = cells
      .slice(4, 18)
      .map(value => Number(value.replace('%', '')));
    if (label === '% Trips') {
      pending.tripPercents = percentages;
    } else if (label === '% Hours' && pending.tripPercents) {
      results.push({
        base: pending.base,
        aircraft: pending.aircraft,
        position: pending.position,
        tripSupply: {
          totalTrips: pending.totalTrips,
          averageTripDays: pending.averageTripDays,
          byDays: pending.counts
            .map((count, index) => ({
              days: index + 1,
              count,
              tripPercent: pending!.tripPercents![index] || 0,
              hoursPercent: percentages[index] || 0,
            }))
            .filter(day => day.count > 0),
        },
      });
      pending = undefined;
    }
  }

  return results;
}

/** Parse fleet notes for block-hour changes, route changes, and commutability. */
export function parsePublishedFleetAnalytics(
  text: string
): PublishedFleetAnalytics[] {
  const results: PublishedFleetAnalytics[] = [];
  const lines = text.split('\n').map(line => line.trim());
  let aircraft = '';
  let addedRoutes: string[] = [];
  let removedRoutes: string[] = [];
  let inMarketChanges = false;
  let blockByPosition = new Map<
    string,
    { current: number; previous: number }
  >();
  let commutabilityByBase = new Map<string, CommutabilitySummary>();

  const flush = () => {
    if (!aircraft) return;
    const positions =
      blockByPosition.size > 0 ? [...blockByPosition.keys()] : [''];
    const bases =
      commutabilityByBase.size > 0 ? [...commutabilityByBase.keys()] : [''];
    for (const position of positions) {
      for (const base of bases) {
        const block = blockByPosition.get(position);
        results.push({
          aircraft,
          position: position || undefined,
          base: base || undefined,
          commutability: commutabilityByBase.get(base),
          marketChanges: block
            ? {
                currentBlockHours: block.current,
                previousBlockHours: block.previous,
                addedRoutes: [...new Set(addedRoutes)],
                removedRoutes: [...new Set(removedRoutes)],
              }
            : undefined,
        });
      }
    }
  };

  for (const line of lines) {
    const fleetMatch = line.match(
      /^(B-)?(330|350|765|717|220|320|73N|757\/7ER)\s+[–-].*(?:Crew Planner|Manager Crew Planning)/i
    );
    if (fleetMatch) {
      flush();
      aircraft = normalizePublishedFleet(
        `${fleetMatch[1] || ''}${fleetMatch[2]}`
      );
      addedRoutes = [];
      removedRoutes = [];
      blockByPosition = new Map();
      commutabilityByBase = new Map();
      inMarketChanges = false;
      continue;
    }
    if (!aircraft) continue;

    const blockMatch = line.match(
      /in bid period (?:(A|B) seat|pilot) block totals ([\d,]+) hours versus .*? at ([\d,]+) hours/i
    );
    if (blockMatch) {
      const current = Number(blockMatch[2].replaceAll(',', ''));
      const previous = Number(blockMatch[3].replaceAll(',', ''));
      if (blockMatch[1]) {
        blockByPosition.set(blockMatch[1].toUpperCase(), { current, previous });
      } else {
        blockByPosition.set('A', { current, previous });
        blockByPosition.set('B', { current, previous });
      }
      continue;
    }

    if (/^Added to .*Removed from/i.test(line)) {
      inMarketChanges = true;
      continue;
    }
    if (/^Commutable trips:/i.test(line)) {
      inMarketChanges = false;
      continue;
    }
    if (inMarketChanges) {
      const routes = line.match(/\b[A-Z]{6}\b/g) || [];
      if (routes.length >= 3) {
        addedRoutes.push(...routes.slice(0, -1));
        removedRoutes.push(routes.at(-1)!);
      } else if (routes.length === 2) {
        addedRoutes.push(routes[0]);
        removedRoutes.push(routes[1]);
      } else if (routes.length === 1) {
        addedRoutes.push(routes[0]);
      }
      continue;
    }

    const commuteMatch = line.match(
      /^([A-Z]{3})\s*[–-]\s*(\d+)% commutable both ends, commutable starts are (\d+)% and commutable ends are (\d+)%/i
    );
    if (commuteMatch) {
      commutabilityByBase.set(commuteMatch[1].toUpperCase(), {
        bothEndsPercent: Number(commuteMatch[2]),
        startPercent: Number(commuteMatch[3]),
        endPercent: Number(commuteMatch[4]),
      });
    }
  }
  flush();

  return results;
}

export function attachPublishedBidAnalytics(
  rows: BidCategoryParameters[],
  text: string
): BidCategoryParameters[] {
  const supply = parsePublishedTripSupply(text);
  const fleetAnalytics = parsePublishedFleetAnalytics(text);

  return rows.map(row => {
    const matchingSupply = supply.find(
      item =>
        item.base === row.base &&
        item.aircraft === row.aircraft &&
        item.position === row.position
    );
    const matchingFleet = fleetAnalytics.find(
      item =>
        item.aircraft === row.aircraft &&
        (!item.base || item.base === row.base) &&
        (!item.position || item.position === row.position)
    );
    return {
      ...row,
      ...(matchingSupply ? { tripSupply: matchingSupply.tripSupply } : {}),
      ...(matchingFleet?.commutability
        ? { commutability: matchingFleet.commutability }
        : {}),
      ...(matchingFleet?.marketChanges
        ? { marketChanges: matchingFleet.marketChanges }
        : {}),
    };
  });
}
