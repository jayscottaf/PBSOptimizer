import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseOutcomeMetrics } from '../lib/outcome-metrics';

test('extracts matching, award, seniority-loss, and line-total counts', () => {
  assert.deepEqual(
    parseOutcomeMetrics(
      'Awarded to senior bidder',
      '11; (1 Awarded, 18 Matching, Running total: 012:43)'
    ),
    {
      awardedCount: 1,
      matchingCount: 18,
      runningTotal: '012:43',
      seniorBidderCount: 11,
      exclusions: [],
      automaticFallback: null,
    }
  );
});

test('does not reinterpret unrelated leading numbers as seniority losses', () => {
  assert.deepEqual(
    parseOutcomeMetrics(
      'Honored',
      '(0 Awarded, 449 Matching, Running total: 063:57)'
    ),
    {
      awardedCount: 0,
      matchingCount: 449,
      runningTotal: '063:57',
      seniorBidderCount: null,
      exclusions: [],
      automaticFallback: null,
    }
  );
});

test('keeps selection losses separate from seniority and the automatic fallback', () => {
  const metrics = parseOutcomeMetrics(
    'Awarded to senior bidder',
    '8; Item overlaps with another: 1; Filtered by bid number 12: 2; (0 Awarded, 11 Matching, Running total: 062:59)\nAutomatic Award Pairings:\nAwarded to senior bidder: 220\nViolates bid number 13: 63\nFiltered by bid number 12: 64\n(0 Awarded, 449 Matching, Running total: 062:59)'
  );
  assert.equal(metrics.matchingCount, 11);
  assert.equal(metrics.seniorBidderCount, 8);
  assert.deepEqual(metrics.exclusions, [
    { bidNumber: 12, count: 2, reason: 'filtered' },
  ]);
  assert.equal(metrics.automaticFallback?.matchingCount, 449);
  assert.equal(metrics.automaticFallback?.seniorBidderCount, 220);
  assert.deepEqual(metrics.automaticFallback?.exclusions, [
    { bidNumber: 13, count: 63, reason: 'violates' },
    { bidNumber: 12, count: 64, reason: 'filtered' },
  ]);
});

test('reads a legacy first-outcome filter detail', () => {
  assert.deepEqual(
    parseOutcomeMetrics('Filtered by bid number', '12: 6').exclusions,
    [{ bidNumber: 12, count: 6, reason: 'filtered' }]
  );
  assert.equal(parseOutcomeMetrics('Honored', null).automaticFallback, null);
});
