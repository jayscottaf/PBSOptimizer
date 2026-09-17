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
    }
  );
});
