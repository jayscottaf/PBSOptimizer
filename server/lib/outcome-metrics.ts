export interface OutcomeMetrics {
  awardedCount: number | null;
  matchingCount: number | null;
  runningTotal: string | null;
  seniorBidderCount: number | null;
}

export function parseOutcomeMetrics(
  outcome: string,
  detail: string | null
): OutcomeMetrics {
  const stats = detail?.match(
    /\((\d+)\s+Awarded,\s+(\d+)\s+Matching,\s+Running\s+total:\s*([0-9]{1,3}:[0-5][0-9])\)/i
  );
  const leadingCount = detail?.match(/^\s*(\d+)\s*(?:;|$)/);
  return {
    awardedCount: stats ? Number(stats[1]) : null,
    matchingCount: stats ? Number(stats[2]) : null,
    runningTotal: stats?.[3] ?? null,
    seniorBidderCount:
      outcome.startsWith('Awarded to senior') && leadingCount
        ? Number(leadingCount[1])
        : null,
  };
}
