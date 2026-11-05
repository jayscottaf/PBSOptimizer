import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFParser } from '../pdfParser';
import { checkParsedPairing } from '../lib/pairing-parse-checks';

// Real 4-day pairing from the NYC 220 AUG package, as the parser sees it.
const REAL_BLOCK = [
  '#7653  SA              EFFECTIVE AUG02 ONLY                  CHECK-IN AT 13.59',
  'DAY   FLIGHT T  DEPARTS   ARRIVES C BLK.  TURN BLK/MAX FDP/MAX PWA FDP/MAX',
  'A      2895    EWR 1459  MSP 1655  2.56  2.55 221                           2',
  '2044    MSP 1950  MKE 2103  1.13       223    8.04/12.00  8.04/11.30 2',
  'MKE 18.57/DRURY PLAZA MKE DTWN          4.09/ 9.00  .14DTY  4.23TL',
  'B      2885   *MKE 1730  MSP 1857  1.27   .53 221                           2',
  '2692    MSP 1950  JFK 2354  3.04              6.24/12.00  6.24/11.30 2',
  'JFK 16.35/GRAND HYATT                   4.31/ 9.00  .00CRD  4.31TL',
  'C       496    JFK 1759  DFW 2108  4.09           M  5.09/12.00  5.09/11.30 2',
  'DFW 12.09/MARRIOTT DFW NORTH            4.09/ 9.00  .00CRD  4.09TL',
  'D      2972   *DFW 1047  MSP 1322  2.35   .58 223 M                         2',
  '1817    MSP 1420  EWR 1755* 2.35              7.08/14.00  7.08/13.00 2',
  'TOTAL CREDIT 21.50TL  17.59BL    3.51CR   26.45FDP                TAFB  76.26',
  'TOTAL PAY    22:18TL    .28SIT    .00EDP    .00HOL    .00CARVE',
].join('\n');

const parse = (block: string) =>
  (new PDFParser() as any).parsePairingBlock(block, null);

test('a well-formed real pairing parses with no warnings', () => {
  const pairing = parse(REAL_BLOCK);
  assert.equal(pairing.pairingDays, 4);
  assert.equal(pairing.effectiveDates, 'AUG02 ONLY');
  assert.deepEqual(pairing.parseWarnings, []);
});

test('a missing EFFECTIVE range is reported, not replaced by a guessed month', () => {
  const pairing = parse(
    REAL_BLOCK.replace('EFFECTIVE AUG02 ONLY', '                    ')
  );
  assert.equal(pairing.effectiveDates, '');
  assert.ok(
    pairing.parseWarnings.some((w: string) => /No EFFECTIVE date range/.test(w))
  );
});

test('trips longer than 10 days are read through day letter N', () => {
  const days = 'ABCDEFGHIJK'.split('');
  const rows = days.map(
    (day, i) =>
      `${day}      ${2000 + i}    EWR 0800  ATL 1000  2.00                         2`
  );
  const block = [
    '#9001  MO              EFFECTIVE AUG03 ONLY                  CHECK-IN AT  7.00',
    ...rows,
    'TOTAL CREDIT 60.00TL  22.00BL    3.51CR   26.45FDP                TAFB 250.00',
  ].join('\n');
  const pairing = parse(block);
  assert.equal(pairing.pairingDays, 11);
  assert.deepEqual(pairing.parseWarnings, []);
});

test('a day count that disagrees with TAFB is reported', () => {
  const pairing = parse(REAL_BLOCK.replace('TAFB  76.26', 'TAFB 150.00'));
  assert.ok(
    pairing.parseWarnings.some((w: string) => /disagrees with TAFB/.test(w))
  );
});

test('an unreadable EXCEPT clause is reported', () => {
  const warnings = checkParsedPairing(`${REAL_BLOCK}\nEXCEPT SEE NOTE`, {
    effectiveDates: 'AUG02 ONLY',
    pairingDays: 4,
    operatingDows: [6],
    exceptDates: [],
    layoversFound: 3,
  });
  assert.ok(warnings.some(w => /EXCEPT clause/.test(w)));
});

test('more layover cities than nights is reported', () => {
  const warnings = checkParsedPairing(REAL_BLOCK, {
    effectiveDates: 'AUG02 ONLY',
    pairingDays: 4,
    operatingDows: [6],
    exceptDates: [],
    layoversFound: 5,
  });
  assert.ok(warnings.some(w => /only 3 were kept/.test(w)));
});

test('a trip with flights but no readable credit is still rejected by the parser', () => {
  assert.equal(parse(REAL_BLOCK.replace(/TOTAL CREDIT.*\n/, '')), null);
});
