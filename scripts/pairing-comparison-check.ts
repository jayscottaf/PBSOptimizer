import {
  bestPairingId,
  bestPairingIds,
  buildPairingComparison,
  buildPairingComparisons,
} from '../client/src/lib/pairing-comparison';
import type { Pairing } from '../client/src/lib/api';

let failures = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`PASS: ${label}`);
  } else {
    console.error(`FAIL: ${label}`);
    failures += 1;
  }
}

function fixture(overrides: Partial<Pairing> = {}): Pairing {
  return {
    id: 1,
    bidPackageId: 10,
    pairingNumber: 'A101',
    effectiveDates: 'OCT01-OCT31',
    route: 'JFK-BOS-LAX-JFK',
    creditHours: '18.50',
    blockHours: '15.25',
    tafb: '3d 04:30',
    deadheads: 1,
    layovers: [
      { city: 'bos', duration: '18.48' },
      { city: 'LAX', duration: '12:15' },
      { city: 'BOS', duration: '09.00' },
    ],
    flightSegments: [
      { date: 'A', departure: 'jfk', departureTime: '21.30' },
      { date: 'C', departure: 'LAX', departureTime: '2230' },
    ],
    checkInTime: '21.30',
    holdProbability: 72,
    holdProbabilityReasoning: ['Category history', 'Less popular layover'],
    ...overrides,
  };
}

const full = buildPairingComparison(fixture());
assert(full.creditMinutes === 1110, 'converts decimal credit hours to minutes');
assert(full.blockMinutes === 915, 'converts decimal block hours to minutes');
assert(full.tafbMinutes === 4590, 'parses TAFB with a day prefix');
assert(
  full.creditBlockRatio !== null &&
    Math.abs(full.creditBlockRatio - 1110 / 915) < 0.000001,
  'calculates credit-to-block ratio'
);
assert(full.pairingDays === 3, 'derives pairing days from segment letters');
assert(full.longestLayoverMinutes === 1128, 'finds longest layover');
assert(full.totalLayoverMinutes === 2403, 'totals every layover duration');
assert(
  full.layoverCities.join(',') === 'BOS,LAX',
  'normalizes and deduplicates layover cities'
);
assert(
  full.checkInStation === 'JFK',
  'uses first departure as check-in station'
);
assert(full.checkInTime === '21:30', 'normalizes check-in time');
assert(full.hasRedeye, 'detects a redeye segment');
assert(full.holdReasoning.length === 2, 'preserves hold reasoning');

const serialized = buildPairingComparison(
  fixture({
    id: 2,
    layovers: JSON.stringify([{ city: 'SLC', duration: '20.30' }]),
    flightSegments: JSON.stringify([
      { day: 4, departure: 'ATL', departureTime: '0900' },
    ]),
    checkInTime: undefined,
    pairingDays: undefined,
    holdProbabilityReasoning: JSON.stringify([
      'Historic award',
    ]) as unknown as string[],
  })
);
assert(serialized.totalLayoverMinutes === 1230, 'accepts serialized layovers');
assert(serialized.pairingDays === 4, 'derives days from numeric segment day');
assert(
  serialized.checkInStation === 'ATL',
  'accepts serialized flight segments'
);
assert(
  serialized.checkInTime === '09:00',
  'falls back to first departure time'
);
assert(!serialized.hasRedeye, 'reports false when no segment is a redeye');
assert(
  serialized.holdReasoning[0] === 'Historic award',
  'accepts serialized reasoning'
);

const missing = buildPairingComparison(
  fixture({
    id: 3,
    creditHours: 'bad',
    blockHours: '0',
    tafb: 'unknown',
    deadheads: Number.NaN,
    layovers: null,
    flightSegments: null,
    checkInTime: undefined,
    holdProbability: Number.NaN,
    holdProbabilityReasoning: undefined,
    pairingDays: undefined,
  } as unknown as Partial<Pairing>)
);
assert(missing.creditMinutes === null, 'uses null for invalid credit');
assert(missing.creditBlockRatio === null, 'does not divide by zero block');
assert(missing.tafbMinutes === null, 'uses null for invalid TAFB');
assert(
  missing.totalLayoverMinutes === null,
  'distinguishes missing layovers from a turn'
);
assert(missing.deadheads === null, 'uses null for invalid deadhead count');
assert(missing.checkInStation === null, 'handles missing segments');
assert(!missing.hasRedeye, 'handles missing redeye data safely');

const turn = buildPairingComparison(fixture({ id: 4, layovers: [] }));
assert(
  turn.totalLayoverMinutes === 0,
  'represents a known turn with zero layover minutes'
);
assert(
  turn.longestLayoverMinutes === 0,
  'represents a known turn with no longest layover'
);

const comparisons = buildPairingComparisons([
  fixture({ id: 11, holdProbability: 70, creditHours: '18' }),
  fixture({ id: 12, holdProbability: 80, creditHours: '16' }),
  fixture({ id: 13, holdProbability: 80, creditHours: '20' }),
  fixture({ id: 14, holdProbability: Number.NaN, creditHours: 'bad' }),
]);
assert(
  bestPairingId(comparisons, 'creditMinutes', 'higher') === 13,
  'finds the highest metric'
);
assert(
  bestPairingId(comparisons, 'creditMinutes', 'lower') === 12,
  'finds the lowest metric'
);
assert(
  bestPairingIds(comparisons, 'holdProbability', 'higher').join(',') ===
    '12,13',
  'returns every tied best pairing'
);
assert(
  bestPairingIds([missing], 'creditMinutes', 'higher').length === 0,
  'ignores missing metric values'
);
assert(
  bestPairingId([], 'creditMinutes', 'higher') === null,
  'handles an empty comparison'
);

if (failures > 0) {
  console.error(`\n${failures} pairing comparison check(s) failed.`);
  process.exit(1);
}

console.log('\nAll pairing comparison checks passed.');
