import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectConflicts } from './conflictDetection';
import { calculateValidStartDates } from './pairingDates';

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Tue/Thu/Sat trip, Aug 11-29 2026, skipping Aug 13 15 20 22.
const tueThuSat = {
  id: 1,
  pairingNumber: '7652',
  effectiveDates: 'AUG11-AUG. 29',
  pairingDays: 1,
  operatingDows: [2, 4, 6],
  exceptDates: ['AUG 13', 'AUG 15', 'AUG 20', 'AUG 22'],
};
const calendarItem = (startDate: string, endDate: string) => ({
  pairingId: 99,
  pairingNumber: '8000',
  startDate,
  endDate,
});

test('client start dates honor EXCEPT dates without a weekday clause', () => {
  const dates = calculateValidStartDates('AUG11-AUG. 14', 2026, 1, {
    operatingDows: null,
    exceptDates: ['AUG 12'],
  });
  assert.deepEqual(dates.map(iso), ['2026-08-11', '2026-08-13', '2026-08-14']);
});

test('client start dates anchor a New Year range to the bid month', () => {
  const dates = calculateValidStartDates(
    'DEC30-JAN. 01',
    2027,
    1,
    { operatingDows: null },
    'January'
  );
  assert.deepEqual(dates.map(iso), ['2026-12-30', '2026-12-31', '2027-01-01']);
});

test('a calendar item on a day the trip never flies is not a conflict', () => {
  // Wed Aug 12: inside the effective range, but the trip flies Tue/Thu/Sat.
  const conflicts = detectConflicts(
    [tueThuSat],
    [calendarItem('2026-08-12T08:00:00', '2026-08-12T18:00:00')],
    2026,
    'August'
  );
  assert.equal(conflicts.size, 0);
});

test('a calendar item on a skipped EXCEPT date is not a conflict', () => {
  // Thu Aug 13 is a Thursday but listed in EXCEPT.
  const conflicts = detectConflicts(
    [tueThuSat],
    [calendarItem('2026-08-13T08:00:00', '2026-08-13T18:00:00')],
    2026,
    'August'
  );
  assert.equal(conflicts.size, 0);
});

test('a calendar item on a real departure day is a conflict', () => {
  // Tue Aug 18, afternoon: the trip's day still counts through 23:59.
  const conflicts = detectConflicts(
    [tueThuSat],
    [calendarItem('2026-08-18T15:00:00', '2026-08-18T20:00:00')],
    2026,
    'August'
  );
  assert.equal(conflicts.get(1)?.conflicts.length, 1);
});
