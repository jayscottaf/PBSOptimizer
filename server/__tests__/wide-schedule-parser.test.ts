import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWideSchedulePageItems } from '../wideScheduleParser';
import { buildWideScheduleValidation } from '../lib/wide-schedule-validation';
import type { WideScheduleLine } from '../../shared/schema';

const dates = Array.from({ length: 31 }, (_, index) => ({
  text: String(index + 1),
  x: 113,
  y: 114.5 + index * 20.25,
}));

test('parses anonymized schedule lines from positioned PDF text', () => {
  const parsed = parseWideSchedulePageItems([
    {
      items: [
        { text: 'Period: OCT 2026', x: 20, y: 20 },
        { text: 'Category: NYC-220-B', x: 30, y: 20 },
        ...dates,
        { text: '14985 / 123456789', x: 131, y: 46.9 },
        { text: 'PILOT NAME', x: 137, y: 46.9 },
        { text: 'Cr:063:57', x: 143, y: 46.9 },
        { text: 'Days Off: 19', x: 149, y: 46.9 },
        { text: '8098', x: 150, y: dates[12].y },
        { text: '021:00', x: 144, y: dates[12].y },
        { text: '17:25', x: 132, y: dates[12].y },
        { text: 'RES', x: 156, y: dates[20].y },
        { text: 'Open-1', x: 173, y: 46.9 },
        { text: '7729', x: 192, y: dates[30].y },
        { text: '011:03', x: 186, y: dates[30].y },
      ],
    },
  ]);

  assert.equal(parsed.month, 'OCT');
  assert.equal(parsed.base, 'NYC');
  assert.equal(parsed.lines.length, 2);
  assert.equal(parsed.lines[0].pilotSeniority, 14985);
  assert.equal(parsed.lines[0].sourceLabel, null);
  assert.equal(parsed.lines[0].totalCreditHours, 63.95);
  assert.equal(parsed.lines[0].lineType, 'reserve');
  assert.deepEqual(parsed.lines[0].events, [
    {
      day: 13,
      type: 'pairing',
      code: '8098',
      creditHours: 21,
      checkInTime: '17:25',
    },
    { day: 21, type: 'reserve', code: 'RES' },
  ]);
  assert.equal(parsed.lines[1].pilotSeniority, null);
  assert.equal(parsed.lines[1].sourceLabel, 'Open-1');
  assert.equal(parsed.lines[1].lineType, 'open');
});

const scheduleLine = (
  seniority: number,
  credit: number,
  daysOff: number,
  lineType: 'regular' | 'reserve',
  pairings: string[]
): WideScheduleLine => ({
  id: seniority,
  month: 'OCT',
  year: 2026,
  base: 'NYC',
  aircraft: '220',
  position: 'B',
  pilotSeniority: seniority,
  sourceLabel: null,
  totalCreditHours: credit.toFixed(2),
  daysOff,
  lineType,
  flags: [],
  events: pairings.map((code, index) => ({
    day: index + 1,
    type: 'pairing',
    code,
  })),
  uploadedAt: new Date('2026-09-17T00:00:00Z'),
});

test('builds exact-line benchmarks and pairing reach from award results', () => {
  const result = buildWideScheduleValidation(
    [
      scheduleLine(14900, 70, 17, 'regular', ['7900', '8004']),
      scheduleLine(14985, 63, 20, 'regular', ['7900', '8109']),
      scheduleLine(15100, 67, 18, 'reserve', ['8109', '8200']),
    ],
    14985,
    3
  );

  assert.ok(result);
  assert.equal(result.exactLine?.totalCreditHours, 63);
  assert.deepEqual(result.exactLine?.pairingNumbers, ['7900', '8109']);
  assert.equal(result.nearby.medianCreditHours, 67);
  assert.equal(result.nearby.medianDaysOff, 18);
  assert.equal(result.nearby.regularLines, 2);
  assert.equal(result.nearby.reserveLines, 1);
  assert.equal(result.nearby.averagePairings, 2);

  const juniorAward = result.pairingOutcomes.find(
    outcome => outcome.pairingNumber === '8200'
  );
  const seniorOnlyAward = result.pairingOutcomes.find(
    outcome => outcome.pairingNumber === '8004'
  );
  assert.equal(juniorAward?.awardedAtOrJuniorToUser, true);
  assert.equal(seniorOnlyAward?.awardedAtOrJuniorToUser, false);
});
