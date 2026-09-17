export interface BidCategoryParameters {
  base: string;
  aircraft: string;
  position: string;
  alvHours: number;
  lineConstructionMinHours?: number;
  lineConstructionMaxHours?: number;
  reserveGuaranteeHours?: number;
  reserveRule?: string;
  extraXDay?: boolean;
  vacationSlide?: boolean;
  rllLimit?: number;
  carryOutCreditAllocations?: CarryOutCreditAllocation[];
  displayName?: string;
}

export interface CarryOutCreditAllocation {
  base: string;
  aircraft: string;
  pairingNumber: string;
  departureDate: string;
  arrivalDate: string;
  totalCreditHours: number;
  currentMonthCreditHours: number;
  carryOutCreditHours: number;
}

const normalizedFleet = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/-?[AB]$/, '')
    .replace(/^[A-Z](\d{3})$/, '$1');

export function findBidCategoryParameters(
  table: unknown,
  base: unknown,
  aircraft: unknown,
  position: unknown
): BidCategoryParameters | undefined {
  if (!Array.isArray(table)) return undefined;
  const wantedBase = String(base ?? '')
    .trim()
    .toUpperCase();
  const wantedFleet = normalizedFleet(aircraft);
  const aircraftSeat = String(aircraft ?? '')
    .trim()
    .toUpperCase()
    .match(/-?([AB])$/)?.[1];
  const wantedPosition = String(position || aircraftSeat || '')
    .trim()
    .toUpperCase();

  return table.find(row => {
    const candidate = row as Partial<BidCategoryParameters>;
    return (
      String(candidate.base ?? '')
        .trim()
        .toUpperCase() === wantedBase &&
      normalizedFleet(candidate.aircraft) === wantedFleet &&
      String(candidate.position ?? '')
        .trim()
        .toUpperCase() === wantedPosition
    );
  }) as BidCategoryParameters | undefined;
}
