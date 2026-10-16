import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scorePairings } from '../lib/bidOptimizer';
import { neutralProfile } from '../lib/profileLearner';

test('ranking goals distinguish credit per day from credit per block', () => {
  const trips = [
    {
      pairingNumber: 'credit',
      creditHours: 24,
      blockHours: 24,
      pairingDays: 3,
    },
    {
      pairingNumber: 'efficient',
      creditHours: 18,
      blockHours: 9,
      pairingDays: 3,
    },
    { pairingNumber: 'short', creditHours: 6, blockHours: 6, pairingDays: 1 },
  ];
  const profile = neutralProfile();
  assert.equal(
    scorePairings(trips, { ...profile, rankingGoal: 'credit' })[0]
      .pairingNumber,
    'credit'
  );
  assert.equal(
    scorePairings(trips, { ...profile, rankingGoal: 'efficiency' })[0]
      .pairingNumber,
    'efficient'
  );
  assert.equal(
    scorePairings(trips, {
      ...profile,
      rankingGoal: 'qol',
      preferredTripLengths: [1],
    })[0].pairingNumber,
    'short'
  );
  assert.equal(
    scorePairings(
      [
        ...trips,
        {
          pairingNumber: 'missing',
          creditHours: 30,
          blockHours: 0,
          pairingDays: 3,
        },
      ],
      { ...profile, rankingGoal: 'efficiency' }
    )[0].pairingNumber,
    'efficient'
  );
});
