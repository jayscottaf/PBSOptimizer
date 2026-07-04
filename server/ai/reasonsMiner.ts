/**
 * Turns Reasons Report outcome data into coach prompt context. The
 * aggregation happens in SQL (storage.getStrategyStats) because the corpus
 * is ~100k preference rows; this module just renders the numbers into
 * concise, actionable prompt lines.
 */

export interface StrategyStats {
  bandLow: number;
  bandHigh: number;
  periods: number;
  denialModePeriods: number;
  categories: Array<{
    category: string;
    total: number;
    honored: number;
    denied: number;
    producedAward: number;
    avgAwardDepth: number | null;
  }>;
}

/**
 * Build the coach's personalization context from seniority-band aggregates:
 * what happened to preferences bid by pilots NEAR the user's percentile,
 * across every imported period. Returns '' when there is no data.
 */
export function buildStrategyContext(stats: StrategyStats): string {
  if (stats.categories.length === 0 || stats.periods === 0) return '';

  const lines: string[] = [
    `OUTCOMES FOR PILOTS NEAR YOUR SENIORITY (${stats.bandLow}th-${stats.bandHigh}th percentile band, ${stats.periods} imported bid periods — use to personalize advice):`,
  ];
  for (const c of stats.categories) {
    if (c.category === 'Other' || c.total < 10) continue;
    let line: string;
    if (c.category === 'Award Pairings') {
      // Award preferences never get an "Honored" line — they either produce
      // award events or are denied/filtered — so rate them by production.
      const producedPct = Math.round((c.producedAward / c.total) * 100);
      const deniedPct = Math.round((c.denied / c.total) * 100);
      line = `- Award Pairings: produced a trip in ${producedPct}% of ${c.total} bids; ${deniedPct}% lost to a more senior bidder.`;
      if (c.avgAwardDepth !== null) {
        line += ` Awards that landed did so at preference #${c.avgAwardDepth.toFixed(0)} on average — advise stacking many specific Awards and expect the top ones to be taken by seniors.`;
      }
    } else {
      const honoredPct = Math.round((c.honored / c.total) * 100);
      const deniedPct = Math.round((c.denied / c.total) * 100);
      line = `- ${c.category}: ${honoredPct}% honored, ${deniedPct}% denied of ${c.total} bids.`;
    }
    lines.push(line);
  }
  if (stats.denialModePeriods > 0) {
    lines.push(
      `- Denial Mode ran in ${stats.denialModePeriods} of ${stats.periods} periods — always recommend a broad fallback (generic Award Pairings, reserve group) so dropped preferences degrade gracefully.`
    );
  }
  lines.push(
    '- When a preference type shows a high denial rate at this band, recommend restructuring (broader filters, Else Start Next, different credit window) instead of repeating it.'
  );
  return lines.join('\n');
}

