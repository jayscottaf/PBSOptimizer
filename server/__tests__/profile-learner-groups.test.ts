import assert from 'node:assert/strict';
import { test } from 'node:test';
import { learnProfile } from '../lib/profileLearner';
import { markActiveBidGroups } from '../lib/bid-groups';

test('only groups with actual NAVBLUE evidence are marked active', () => {
  const rows = markActiveBidGroups([
    {
      preferenceText: 'Reduced line preference',
      outcome: 'Unknown',
      month: 'OCT',
      year: 2026,
      bidGroup: 'Bid Group 1: Pairing Bid Group (Reduced Regular Line)',
      producedAward: false,
    },
    {
      preferenceText: 'Regular line preference',
      outcome: 'Honored',
      month: 'OCT',
      year: 2026,
      bidGroup: 'Bid Group 2: Pairing Bid Group',
      producedAward: false,
    },
    {
      preferenceText: 'Fallback preference',
      outcome: 'Unknown',
      month: 'OCT',
      year: 2026,
      bidGroup: 'Bid Group 3: Pairing Bid Group',
      producedAward: false,
    },
  ]);
  assert.deepEqual(
    rows.map(row => row.groupActive),
    [false, true, false]
  );
});

test('profile learning ignores preferences from demonstrably inactive groups', () => {
  const result = learnProfile(
    [
      {
        preferenceText: 'Avoid Pairings If Redeye',
        groupActive: false,
      },
      {
        preferenceText: 'Avoid Pairings If Carry Out > 0',
        groupActive: true,
      },
      {
        preferenceText: 'Avoid Pairings If Carry Out > 0',
        groupActive: true,
      },
    ],
    2
  );
  assert.equal(result.weights.avoidsRedeyes, false);
  assert.equal(result.weights.avoidsCarryOut, true);
  assert.equal(result.signals.rows, 2);
  assert.equal(result.signals.inactiveGroupRowsIgnored, 1);
});
