import type {
  OutcomeCounts,
  OutcomeMetrics,
} from '../../shared/report-selection-impact';
export type { OutcomeMetrics } from '../../shared/report-selection-impact';

function parseCounts(outcome: string, detail: string | null): OutcomeCounts {
  const stats = detail?.match(
    /\((\d+)\s+Awarded,\s+(\d+)\s+Matching,\s+Running\s+total:\s*([0-9]{1,3}:[0-5][0-9])\)/i
  );
  // Prefix the primary outcome so legacy single-reason details still work.
  const separator = /(?:bid number|higher bid)$/i.test(outcome) ? ' ' : ': ';
  const text = `${outcome}${separator}${detail ?? ''}`;
  const senior = text.match(/Awarded to senior (?:shadow )?bidder:\s*(\d+)/i);
  const exclusions = [
    ...text.matchAll(
      /(Filtered by (?:bid number|higher bid)|Violates bid number)\s*(\d+)\s*:\s*(\d+)/gi
    ),
  ].map(match => ({
    bidNumber: Number(match[2]),
    count: Number(match[3]),
    reason: /^Filtered/i.test(match[1])
      ? ('filtered' as const)
      : ('violates' as const),
  }));
  return {
    awardedCount: stats ? Number(stats[1]) : null,
    matchingCount: stats ? Number(stats[2]) : null,
    runningTotal: stats?.[3] ?? null,
    seniorBidderCount: senior ? Number(senior[1]) : null,
    exclusions,
  };
}

export function parseOutcomeMetrics(
  outcome: string,
  detail: string | null
): OutcomeMetrics {
  const [primary, fallback] = (detail ?? '').split(
    '\nAutomatic Award Pairings:\n'
  );
  return {
    ...parseCounts(outcome, primary),
    automaticFallback: fallback ? parseCounts('', fallback) : null,
  };
}
