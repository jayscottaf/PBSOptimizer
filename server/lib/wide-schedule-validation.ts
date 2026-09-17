import type { WideScheduleLine } from '../../shared/schema';
import type {
  AwardedLineSummary,
  WideScheduleValidation,
} from '../../shared/wide-schedule-validation';

interface ScheduleEvent {
  type?: string;
  code?: string;
}

const pairingNumbers = (line: WideScheduleLine) => [
  ...new Set(
    (Array.isArray(line.events) ? (line.events as ScheduleEvent[]) : [])
      .filter(event => event.type === 'pairing' && event.code)
      .map(event => String(event.code))
  ),
];

const lineSummary = (line: WideScheduleLine): AwardedLineSummary => ({
  seniority: line.pilotSeniority!,
  totalCreditHours: Number(line.totalCreditHours),
  daysOff: line.daysOff,
  lineType: line.lineType,
  pairingNumbers: pairingNumbers(line),
});

const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint];
};

export function buildWideScheduleValidation(
  lines: WideScheduleLine[],
  userSeniority: number,
  sampleSize = 12,
  periodMatchesPackage = true
): WideScheduleValidation | null {
  const pilotLines = lines.filter(
    line => line.pilotSeniority !== null && line.lineType !== 'open'
  );
  if (pilotLines.length === 0) return null;

  const nearbyLines = [...pilotLines]
    .sort(
      (a, b) =>
        Math.abs(a.pilotSeniority! - userSeniority) -
          Math.abs(b.pilotSeniority! - userSeniority) ||
        a.pilotSeniority! - b.pilotSeniority!
    )
    .slice(0, sampleSize);
  const nearbySeniorities = nearbyLines.map(line => line.pilotSeniority!);
  const nearbyDaysOff = nearbyLines
    .map(line => line.daysOff)
    .filter((value): value is number => value !== null);

  const outcomes = new Map<
    string,
    { seniorities: number[]; lineAwards: number }
  >();
  for (const line of pilotLines) {
    for (const pairingNumber of pairingNumbers(line)) {
      const outcome = outcomes.get(pairingNumber) ?? {
        seniorities: [],
        lineAwards: 0,
      };
      outcome.seniorities.push(line.pilotSeniority!);
      outcome.lineAwards += 1;
      outcomes.set(pairingNumber, outcome);
    }
  }

  const source = pilotLines[0];
  const exact = pilotLines.find(line => line.pilotSeniority === userSeniority);
  return {
    available: true,
    month: source.month,
    year: source.year,
    category: `${source.base} ${source.aircraft}${source.position}`,
    userSeniority,
    periodMatchesPackage,
    exactLine: exact ? lineSummary(exact) : null,
    nearby: {
      sampleSize: nearbyLines.length,
      seniorityMin: Math.min(...nearbySeniorities),
      seniorityMax: Math.max(...nearbySeniorities),
      medianCreditHours: median(
        nearbyLines.map(line => Number(line.totalCreditHours))
      )!,
      medianDaysOff: median(nearbyDaysOff),
      regularLines: nearbyLines.filter(line => line.lineType === 'regular')
        .length,
      reserveLines: nearbyLines.filter(line => line.lineType === 'reserve')
        .length,
      averagePairings:
        nearbyLines.reduce(
          (sum, line) => sum + pairingNumbers(line).length,
          0
        ) / nearbyLines.length,
    },
    pairingOutcomes: [...outcomes.entries()]
      .map(([pairingNumber, outcome]) => {
        const mostSeniorSeniority = Math.min(...outcome.seniorities);
        const mostJuniorSeniority = Math.max(...outcome.seniorities);
        return {
          pairingNumber,
          lineAwards: outcome.lineAwards,
          mostSeniorSeniority,
          mostJuniorSeniority,
          awardedAtOrJuniorToUser: mostJuniorSeniority >= userSeniority,
        };
      })
      .sort(
        (a, b) =>
          b.mostJuniorSeniority - a.mostJuniorSeniority ||
          b.lineAwards - a.lineAwards ||
          a.pairingNumber.localeCompare(b.pairingNumber)
      ),
  };
}
