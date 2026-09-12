import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pairingsCsv, pairingText } from './pairing-export';

test('exports preserve duration units, CSV quoting, and neutralize spreadsheet formulas', () => {
  const pairing = {
    pairingNumber: '=1+1',
    route: 'JFK,"ATH"\nJFK',
    creditHours: '20.67',
    blockHours: '20.67',
    tafb: '48.55',
    fullTextBlock: 'original text',
  };
  const csv = pairingsCsv([pairing]);
  assert.match(csv, /"'\=1\+1"/);
  assert.match(csv, /"JFK,""ATH""\nJFK"/);
  assert.match(csv, /"20:40","20:40","48:55"/);
  assert.match(pairingText(pairing), /Credit: 20:40/);
  assert.match(pairingText(pairing), /original text/);
  assert.equal(pairingsCsv([]).split('\r\n').length, 1);
});
