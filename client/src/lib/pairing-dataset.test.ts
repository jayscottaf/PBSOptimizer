import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatasetLoader, isCompleteDataset } from './pairing-dataset';
import { filterPairings } from './filter-pairings';

const envelope = (pairings: any[]) => ({
  schema: 1 as const,
  complete: true as const,
  total: pairings.length,
  pairings,
});

test('small and empty complete datasets cache successfully; incomplete responses do not', async () => {
  const saved = new Map<string, unknown>();
  let writes = 0;
  const load = createDatasetLoader({
    read: async key => saved.get(key),
    write: async (key, data) => {
      saved.set(key, data);
      writes++;
    },
  });
  const small = envelope(Array.from({ length: 236 }, (_, id) => ({ id })));
  assert.equal((await load('small', async () => small)).total, 236);
  assert.equal(
    (
      await load('small', async () => {
        throw new Error('offline');
      })
    ).total,
    236
  );
  assert.equal((await load('empty', async () => envelope([]))).total, 0);
  assert.equal(
    (
      await load('empty', async () => {
        throw new Error('offline');
      })
    ).total,
    0
  );
  await assert.rejects(load('partial', async () => ({ ...small, total: 400 })));
  assert.equal(saved.has('partial'), false);
  assert.equal(
    isCompleteDataset(small.pairings),
    false,
    'legacy array cache is not a complete envelope'
  );
  assert.equal(writes, 2);
  await assert.rejects(
    load('small', async () => {
      throw Object.assign(new Error('unauthorized'), { status: 401 });
    })
  );
});

test('duplicate consumers coalesce; profile/package changes keep late results isolated', async () => {
  const saved = new Map<string, unknown>();
  const load = createDatasetLoader({
    read: async key => saved.get(key),
    write: async (key, data) => {
      saved.set(key, data);
    },
  });
  let calls = 0;
  let finish!: (data: unknown) => void;
  const fetchOld = () => {
    calls++;
    return new Promise(resolve => {
      finish = resolve;
    });
  };
  const old = load('profile-old:package-1', fetchOld);
  const duplicate = load('profile-old:package-1', fetchOld);
  assert.equal(old, duplicate);
  const current = await load('profile-new:package-2', async () =>
    envelope([{ id: 2 }])
  );
  finish(envelope([{ id: 1 }]));
  await old;
  assert.equal(calls, 1);
  assert.deepEqual(current.pairings, [{ id: 2 }]);
  assert.deepEqual((saved.get('profile-new:package-2') as any).pairings, [
    { id: 2 },
  ]);
});

test('local filters combine layovers, TAFB, dates, and sorting without mutating the complete dataset', () => {
  const rows: any[] = [
    {
      id: 1,
      pairingNumber: '1001',
      route: 'LGA-BOS-LGA',
      creditHours: '18.50',
      blockHours: '10.00',
      tafb: '10.30',
      holdProbability: 90,
      pairingDays: 1,
      layovers: [{ city: 'BOS', duration: '12.00' }],
      flightSegments: [],
      effectiveDates: 'AUG01-AUG31',
      operatingDows: [1],
      exceptDates: [],
    },
    {
      id: 2,
      pairingNumber: '1002',
      route: 'LGA-MIA-LGA',
      creditHours: '15.00',
      blockHours: '12.00',
      tafb: '11.00',
      holdProbability: 20,
      pairingDays: 1,
      layovers: [{ city: 'MIA', duration: '10.00' }],
      flightSegments: [],
      effectiveDates: 'AUG01-AUG31',
      operatingDows: [2],
      exceptDates: [],
    },
  ];
  const snapshot = JSON.stringify(rows);
  assert.deepEqual(
    filterPairings(
      rows,
      { layoverLocations: ['BOS'], tafbMin: 10.5, tafbMax: 10.5 },
      2026
    ).map(p => p.id),
    [1]
  );
  assert.deepEqual(
    filterPairings(
      rows,
      { excludeLayoverCities: ['BOS'], holdProbabilityMin: 70 },
      2026
    ),
    []
  );
  assert.deepEqual(
    filterPairings(rows, { search: 'aug', creditMin: 18 }, 2026).map(p => p.id),
    [1]
  );
  assert.deepEqual(
    filterPairings(
      rows,
      { preferredDaysOff: [new Date(2026, 7, 3)] },
      2026
    ).map(p => p.id),
    [2]
  );
  assert.equal(JSON.stringify(rows), snapshot);
});
