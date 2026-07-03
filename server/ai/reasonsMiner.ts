/**
 * Mines parsed Reasons Report preference outcomes for patterns the bidding
 * coach can use: what kinds of preferences were honored or denied for this
 * pilot's category in past months. This is the personalization layer - it
 * turns the pilot's own award history into prompt context.
 */

import type { ReasonsReportPreference } from '../../shared/schema';

const DENIED_OUTCOMES = [
  'Not honored',
  'Not considered',
  'Not used',
  'Bid denied',
  'Below Reduced Lower Limit Cutoff',
  // Real composite exports: seniority took it — the clearest denial signal
  'Awarded to senior bidder',
  'Awarded to senior shadow bidder',
];

const HONORED_OUTCOMES = ['Honored', 'Partially honored'];

function classifyPreference(text: string): string {
  const lower = text.toLowerCase();
  if (lower.startsWith('prefer off')) return 'Prefer Off';
  if (lower.startsWith('avoid')) return 'Avoid Pairings';
  if (lower.startsWith('award')) return 'Award Pairings';
  if (lower.startsWith('set condition')) return 'Set Condition';
  if (lower.startsWith('slide vacation')) return 'Slide Vacation';
  if (lower.includes('reserve')) return 'Reserve';
  return 'Other';
}

/**
 * Build a compact history summary for the coach's system prompt. Returns an
 * empty string when there is nothing useful, so callers can append blindly.
 */
export function buildPreferenceHistoryContext(
  records: ReasonsReportPreference[]
): string {
  if (records.length === 0) return '';

  const byCategory = new Map<
    string,
    { honored: number; denied: number; other: number; examples: string[] }
  >();

  const banners = new Set<string>();

  for (const record of records) {
    const category = classifyPreference(record.preferenceText);
    if (!byCategory.has(category)) {
      byCategory.set(category, { honored: 0, denied: 0, other: 0, examples: [] });
    }
    const bucket = byCategory.get(category)!;
    if (HONORED_OUTCOMES.includes(record.outcome)) {
      bucket.honored++;
    } else if (DENIED_OUTCOMES.includes(record.outcome)) {
      bucket.denied++;
      if (bucket.examples.length < 2) {
        bucket.examples.push(
          `"${record.preferenceText.slice(0, 60)}" (${record.outcome}, ${record.month} ${record.year})`
        );
      }
    } else {
      bucket.other++;
    }
    if (Array.isArray(record.reportBanners)) {
      for (const banner of record.reportBanners as string[]) {
        // reportBanners also carries each pilot's credit-window line
        // ("Window 062:00-082:00, Threshold 082:00"); only true report
        // flags belong in the "flagged" prompt line.
        if (/^Affected\s+by/i.test(banner)) {
          banners.add(banner);
        }
      }
    }
  }

  const lines: string[] = [
    'PILOT BID HISTORY (from imported Reasons Reports - use to personalize advice):',
  ];
  for (const [category, stats] of byCategory) {
    const total = stats.honored + stats.denied + stats.other;
    let line = `- ${category}: ${stats.honored}/${total} honored, ${stats.denied}/${total} denied across imported months.`;
    if (stats.examples.length > 0) {
      line += ` Denied examples: ${stats.examples.join('; ')}.`;
    }
    lines.push(line);
  }
  if (banners.size > 0) {
    lines.push(
      `- Past reports were flagged: ${[...banners].join(', ')} - factor that risk into fallback structure.`
    );
  }
  lines.push(
    '- When a preference type keeps being denied at this seniority, recommend restructuring (broader fallback, Else Start Next, or different window) instead of repeating it.'
  );
  return lines.join('\n');
}
