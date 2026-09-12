import type {
  BidHistory,
  BidPackage,
  Pairing,
  User,
} from '../../shared/schema';
import { HoldProbabilityCalculator } from '../holdProbabilityCalculator';

export type HoldPairing = Omit<
  Pairing,
  'fullTextBlock' | 'holdProbabilityReasoning'
>;

/** Stored pairing odds are an ingestion estimate, never a personalized answer. */
export function personalizeHoldProbabilities<T extends HoldPairing>(
  rows: T[],
  context: {
    user?: Pick<User, 'seniorityNumber' | 'seniorityPercentile'>;
    percentile?: number;
    bidPackage: Pick<BidPackage, 'month' | 'base' | 'aircraft'>;
    history: BidHistory[];
    rosters: Map<string, number[]>;
    frequencies: Map<string, number>;
  }
): (T & { holdProbabilityReasoning: string[] })[] {
  const percentile =
    context.percentile ?? context.user?.seniorityPercentile ?? 50;
  if (!Number.isFinite(percentile) || percentile < 0 || percentile > 100) {
    throw new Error('Seniority percentile must be between 0 and 100');
  }
  return rows.map(pairing => {
    const result =
      context.user && context.history.length > 0
        ? HoldProbabilityCalculator.calculateHoldProbabilityWithHistory(
            pairing,
            context.user.seniorityNumber,
            percentile,
            context.history,
            context.bidPackage.month,
            context.rosters
          )
        : HoldProbabilityCalculator.calculateHoldProbability({
            seniorityPercentile: percentile,
            desirabilityScore:
              HoldProbabilityCalculator.calculateDesirabilityScore(
                pairing,
                context.bidPackage.month
              ),
            pairingFrequency:
              context.frequencies.get(pairing.pairingNumber) ?? 1,
            includesDeadheads: pairing.deadheads ?? 0,
            bidMonth: context.bidPackage.month,
            layoverCities: Array.isArray(pairing.layovers)
              ? pairing.layovers.map(l => l.city)
              : [],
          });
    return {
      ...pairing,
      holdProbability: result.probability,
      holdProbabilityReasoning:
        context.history.length === 0
          ? [
              `No award history imported for ${context.bidPackage.base} ${context.bidPackage.aircraft}; this is a seniority-based estimate.`,
              ...result.reasoning,
            ]
          : result.reasoning,
    };
  });
}

export function pairingStatistics(
  rows: Pick<Pairing, 'creditHours' | 'blockHours' | 'holdProbability'>[]
) {
  const statistics = {
    likelyToHold: 0,
    highCredit: 0,
    ratioBreakdown: { excellent: 0, good: 0, average: 0, poor: 0 },
  };
  for (const row of rows) {
    if ((row.holdProbability ?? 0) >= 70) statistics.likelyToHold++;
    if (Number(row.creditHours) >= 18) statistics.highCredit++;
    if (Number(row.blockHours) > 0) {
      const ratio = Number(row.creditHours) / Number(row.blockHours);
      statistics.ratioBreakdown[
        ratio >= 1.3
          ? 'excellent'
          : ratio >= 1.2
            ? 'good'
            : ratio >= 1.1
              ? 'average'
              : 'poor'
      ]++;
    }
  }
  return statistics;
}
