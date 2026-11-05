import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseOperatingDays } from '../../shared/operatingDays';
import { expandOperatingDates } from '../../shared/operatingDates';

const AUG_2026 = { month: 8, year: 2026 };

test('weekday clause and EXCEPT dates leave only the real departures', () => {
  const block =
    '#A227  TU TH SA        EFFECTIVE AUG11-AUG. 29   CHECK-IN AT 20.59\n' +
    '                 EXCEPT AUG 13 AUG 15 AUG 20 AUG 22';
  assert.deepEqual(
    expandOperatingDates(
      { effectiveDates: 'AUG11-AUG. 29', ...parseOperatingDays(block) },
      AUG_2026
    ),
    ['2026-08-11', '2026-08-18', '2026-08-25', '2026-08-27', '2026-08-29']
  );
});

test('EXCEPT dates apply even when the header names no weekdays', () => {
  assert.deepEqual(
    expandOperatingDates(
      {
        effectiveDates: 'AUG11-AUG. 14',
        operatingDows: null,
        exceptDates: ['AUG 12'],
      },
      AUG_2026
    ),
    ['2026-08-11', '2026-08-13', '2026-08-14']
  );
});

test('a range crossing New Year is anchored to the bid period', () => {
  const trip = { effectiveDates: 'DEC28-JAN. 02', operatingDows: null };
  assert.deepEqual(expandOperatingDates(trip, { month: 1, year: 2027 }), [
    '2026-12-28',
    '2026-12-29',
    '2026-12-30',
    '2026-12-31',
    '2027-01-01',
    '2027-01-02',
  ]);
  assert.deepEqual(
    expandOperatingDates(trip, { month: 12, year: 2026 }).slice(-1),
    ['2027-01-02']
  );
});

test('older rows with EXCEPT text inside the stored range still expand correctly', () => {
  assert.deepEqual(
    expandOperatingDates(
      { effectiveDates: 'OCT14-OCT.29 EXCEPT MO SA SU EXCEPT OCT 16 OCT 21' },
      { month: 10, year: 2026 }
    ),
    [
      '2026-10-14',
      '2026-10-15',
      '2026-10-20',
      '2026-10-22',
      '2026-10-23',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
    ]
  );
});

test('a single-date trip departs once', () => {
  assert.deepEqual(
    expandOperatingDates(
      { effectiveDates: 'AUG03 ONLY', operatingDows: [1] },
      AUG_2026
    ),
    ['2026-08-03']
  );
});

test('a weekday filter that matches nothing falls back to the range instead of dropping the trip', () => {
  assert.deepEqual(
    expandOperatingDates(
      { effectiveDates: 'AUG12 ONLY', operatingDows: [5] },
      AUG_2026
    ),
    ['2026-08-12']
  );
});

test('unparseable ranges produce no dates', () => {
  assert.deepEqual(expandOperatingDates({ effectiveDates: '' }, AUG_2026), []);
  assert.deepEqual(
    expandOperatingDates({ effectiveDates: 'TBD' }, AUG_2026),
    []
  );
});
