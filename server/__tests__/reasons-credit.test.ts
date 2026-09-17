import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseReasonsCredits } from '../lib/reasons-credit';

test('accepts an unavailable optional total credit', () => {
  assert.deepEqual(parseReasonsCredits('7652', '17:38', '#N/A'), {
    creditHours: 17 + 38 / 60,
    totalCredit: null,
  });
});

test('still rejects an unavailable required month credit', () => {
  assert.throws(
    () => parseReasonsCredits('7652', '#N/A', '17:38'),
    /Invalid credit for pairing 7652/
  );
});
