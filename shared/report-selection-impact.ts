export interface ReportExclusion {
  bidNumber: number;
  count: number;
  reason: 'filtered' | 'violates';
}

export interface OutcomeCounts {
  awardedCount: number | null;
  matchingCount: number | null;
  runningTotal: string | null;
  seniorBidderCount: number | null;
  exclusions: ReportExclusion[];
}

export interface OutcomeMetrics extends OutcomeCounts {
  automaticFallback: OutcomeCounts | null;
}

interface PreferenceWithMetrics extends OutcomeMetrics {
  preferenceNumber: number;
  bidGroup?: string;
  groupActive?: boolean;
}

/** Use one reported candidate pool, never sum potentially overlapping pools. */
export function selectionImpact(
  selection: Pick<PreferenceWithMetrics, 'preferenceNumber' | 'bidGroup'>,
  preferences: PreferenceWithMetrics[]
) {
  const pools = preferences
    .filter(p => p.groupActive !== false && p.bidGroup === selection.bidGroup)
    .flatMap(p => [p, ...(p.automaticFallback ? [p.automaticFallback] : [])]);
  const candidates = pools.flatMap(pool => {
    const exclusions = (pool.exclusions ?? []).filter(
      exclusion => exclusion.bidNumber === selection.preferenceNumber
    );
    if (exclusions.length === 0) return [];
    return [
      {
        count: Math.max(...exclusions.map(exclusion => exclusion.count)),
        matchingCount: pool.matchingCount,
      },
    ];
  });
  return candidates.sort((a, b) => b.count - a.count)[0] ?? null;
}
