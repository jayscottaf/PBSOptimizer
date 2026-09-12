import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { db, cleanup } from '../db';
import { storage } from '../storage';
import { personalizeHoldProbabilities } from '../lib/hold-probabilities';
import type { Pairing } from '../../shared/schema';

after(cleanup);

const rows = [
  {
    id: 1,
    bidPackageId: 1,
    pairingNumber: '1001',
    creditHours: '18.50',
    blockHours: '15.00',
    tafb: '48.00',
    pairingDays: 3,
    deadheads: 0,
    layovers: [],
    flightSegments: [],
    holdProbability: 50,
  },
] as unknown as Pairing[];
const context = {
  bidPackage: { month: 'August', base: 'NYC', aircraft: 'A220' },
  history: [],
  rosters: new Map<string, number[]>(),
  frequencies: new Map([['1001', 1]]),
};

test('stored odds are replaced by the current profile, including the zero percentile', () => {
  const senior = personalizeHoldProbabilities(rows, {
    ...context,
    percentile: 10,
  });
  const junior = personalizeHoldProbabilities(rows, {
    ...context,
    percentile: 90,
  });
  assert.ok(senior[0].holdProbability > junior[0].holdProbability);
  assert.equal(
    rows[0].holdProbability,
    50,
    'personalization never mutates stored rows'
  );
  assert.ok(
    personalizeHoldProbabilities(rows, { ...context, percentile: 0 })[0]
      .holdProbability >= senior[0].holdProbability
  );
  assert.throws(() =>
    personalizeHoldProbabilities(rows, { ...context, percentile: 101 })
  );
});

test('search filters, sorting, and statistics use newly calculated probabilities', async () => {
  const select = db.select;
  const personalize = storage.personalizePairings;
  try {
    db.select = (() => ({
      from: () => ({
        where: () => ({ orderBy: () => ({ execute: async () => rows }) }),
      }),
    })) as any;
    storage.personalizePairings = (async (
      input: Pairing[],
      percentile?: number
    ) =>
      personalizeHoldProbabilities(input, { ...context, percentile })) as any;
    const senior = await storage.getAllPairingsForBidPackage({
      bidPackageId: 1,
      seniorityPercentage: 10,
      holdProbabilityMin: 70,
      sortBy: 'holdProbability',
      sortOrder: 'desc',
    });
    const junior = await storage.getAllPairingsForBidPackage({
      bidPackageId: 1,
      seniorityPercentage: 90,
      holdProbabilityMin: 70,
    });
    assert.equal(
      senior.pairings.length,
      1,
      'stored 50% must not pre-filter a senior pilot'
    );
    assert.equal(senior.statistics.likelyToHold, 1);
    assert.equal(junior.pairings.length, 0);
    assert.equal(junior.statistics.likelyToHold, 0);
  } finally {
    db.select = select;
    storage.personalizePairings = personalize;
  }
});
