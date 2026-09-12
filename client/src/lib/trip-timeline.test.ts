import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupTripDays, formatFlightTime } from './trip-timeline';

test('timeline keeps missing-day offsets, long trips, and unrecognized segments', () => {
  const groups = groupTripDays([
    { date: 'C' },
    { date: 'A' },
    { day: 'H' },
    { date: 'C' },
    { date: 'invalid' },
  ]);
  assert.deepEqual(
    groups.map(g => g.day),
    [1, 3, 8, null]
  );
  assert.equal(groups[1].flights.length, 2);
  assert.equal(
    groups.reduce((n, g) => n + g.flights.length, 0),
    5
  );
});
test('flight times preserve clock values and do not invent missing times', () => {
  assert.equal(formatFlightTime('0750'), '07:50');
  assert.equal(formatFlightTime('15.15'), '15:15');
  assert.equal(formatFlightTime('10:05'), '10:05');
  assert.equal(formatFlightTime(), '—');
});
