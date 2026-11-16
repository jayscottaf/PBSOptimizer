import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findSameDeparture } from '../lib/calendar-events';

// Trip #7662 departs Sat Aug 2 and Tue Aug 5 (NYC 220 AUG 2025).
const aug2 = { id: 1, startDate: new Date('2025-08-02T06:30:00') };

test('a second departure of the same trip is a new calendar entry', () => {
  assert.equal(
    findSameDeparture([aug2], new Date('2025-08-05T06:30:00')),
    undefined
  );
});

test('re-adding the same departure updates it, even with changed duty times', () => {
  assert.equal(
    findSameDeparture([aug2], new Date('2025-08-02T05:45:00')),
    aug2
  );
});

test('departures on consecutive days are kept apart', () => {
  assert.equal(
    findSameDeparture([aug2], new Date('2025-08-03T06:30:00')),
    undefined
  );
});
