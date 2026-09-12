import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cacheKeyForPairings } from './offlineCache';

test('long shared prefixes, Unicode, profiles, and packages cannot collide', () => {
  const common = {
    excludeLayoverCities: Array.from({ length: 100 }, (_, i) => `CITY-${i}`),
    search: 'Montréal ✈',
  };
  const low = cacheKeyForPairings(
    61,
    { ...common, minHoldProbability: 20 },
    '7:profile-1'
  );
  const high = cacheKeyForPairings(
    61,
    { ...common, minHoldProbability: 90 },
    '7:profile-1'
  );
  assert.notEqual(low, high);
  assert.notEqual(
    low,
    cacheKeyForPairings(
      61,
      { ...common, minHoldProbability: 20 },
      '7:profile-2'
    )
  );
  assert.notEqual(
    low,
    cacheKeyForPairings(
      62,
      { ...common, minHoldProbability: 20 },
      '7:profile-1'
    )
  );
  assert.equal(
    new Map([
      [low, 'low'],
      [high, 'high'],
    ]).get(low),
    'low'
  );
});

test('equivalent filters are canonical and old keys cannot be reused', () => {
  assert.equal(
    cacheKeyForPairings(61, {
      nested: { b: 2, a: 1 },
      zero: 0,
      enabled: false,
    }),
    cacheKeyForPairings(61, { enabled: false, zero: 0, nested: { a: 1, b: 2 } })
  );
  assert.equal(
    cacheKeyForPairings(61, {
      page: 2,
      limit: 10,
      sortBy: 'credit',
      sortOrder: 'desc',
    }),
    cacheKeyForPairings(61)
  );
  assert.notEqual(
    cacheKeyForPairings(61, undefined, 7),
    'user:7:pairings:61:all'
  );
  assert.notEqual(
    cacheKeyForPairings(undefined, { minHoldProbability: 20 }),
    cacheKeyForPairings(undefined, { minHoldProbability: 90 })
  );
});
