import assert from 'node:assert/strict';
import { test } from 'node:test';
import { departureDates, formatDepartureDates } from './pairingDates';

// Real trips from the NYC 220 AUG 2025 package.
const show = (
  effectiveDates: string,
  operatingDows: number[] | null,
  exceptDates: string[] = []
) =>
  formatDepartureDates(
    departureDates(
      effectiveDates,
      2025,
      { operatingDows, exceptDates },
      'August'
    )
  );

test('lists every departure instead of the range endpoints', () => {
  // EXCPT MO TU SA, AUG15-AUG. 29, except AUG 17 and 20: seven departures,
  // previously shown as "AUG15, AUG29 WE,TH,FR,SU".
  assert.equal(
    show('AUG15-AUG. 29', [0, 3, 4, 5], ['AUG 17', 'AUG 20']),
    'AUG 15, 21, 22, 24, 27–29'
  );
  // EXCPT SA, AUG01-AUG. 10, except AUG 03.
  assert.equal(
    show('AUG01-AUG. 10', [0, 1, 2, 3, 4, 5], ['AUG 03']),
    'AUG 1, 4–8, 10'
  );
});

test('a range whose weekdays leave two departures shows both', () => {
  // TU SA, AUG02-AUG. 05: Saturday Aug 2 and Tuesday Aug 5.
  assert.equal(show('AUG02-AUG. 05', [2, 6]), 'AUG 2, 5');
});

test('two consecutive days stay separate; three or more collapse', () => {
  assert.equal(
    formatDepartureDates(['2025-08-21', '2025-08-22']),
    'AUG 21, 22'
  );
  assert.equal(
    formatDepartureDates(['2025-08-01', '2025-08-02', '2025-08-03']),
    'AUG 1–3'
  );
});

test('departures across a month boundary are grouped by month', () => {
  assert.equal(
    formatDepartureDates(['2025-07-30', '2025-07-31', '2025-08-01']),
    'JUL 30, 31 · AUG 1'
  );
});
