import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectionImpact } from '../../shared/report-selection-impact';
import { parseOutcomeMetrics } from '../lib/outcome-metrics';

test('shows one candidate pool instead of double-counting repeated exclusions', () => {
  const rows = [6, 4, 2].map((count, index) => ({
    preferenceNumber: 17 + index,
    bidGroup: 'Bid Group 2',
    groupActive: true,
    ...parseOutcomeMetrics(
      'Awarded to senior bidder',
      `11; Filtered by bid number 12: ${count}; (1 Awarded, 18 Matching, Running total: 012:43)${index === 2 ? '\nAutomatic Award Pairings:\nFiltered by bid number 12: 64\n(0 Awarded, 449 Matching, Running total: 062:59)' : ''}`
    ),
  }));
  rows.push({
    ...rows[0],
    bidGroup: 'Bid Group 1',
    ...parseOutcomeMetrics('Filtered by bid number', '12: 999'),
  });
  rows.push({
    ...rows[0],
    groupActive: false,
    ...parseOutcomeMetrics('Filtered by bid number', '12: 888'),
  });
  assert.deepEqual(
    selectionImpact({ preferenceNumber: 12, bidGroup: 'Bid Group 2' }, rows),
    { count: 64, matchingCount: 449 }
  );
  assert.equal(
    selectionImpact({ preferenceNumber: 14, bidGroup: 'Bid Group 2' }, rows),
    null
  );
});
