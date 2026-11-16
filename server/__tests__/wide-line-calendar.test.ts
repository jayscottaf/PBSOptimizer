import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWideSchedulePageItems } from '../wideScheduleParser';
import { buildLineCalendarItems } from '../lib/wide-line-calendar';

// Day header positions as printed on NAVBLUE wide schedules (DEC 2026).
const dates = Array.from({ length: 31 }, (_, index) => ({
  text: String(index + 1),
  x: 113,
  y: 114.5 + index * 20.25,
}));
const report = (rows: Array<{ text: string; x: number; y: number }>) =>
  parseWideSchedulePageItems([
    {
      items: [
        { text: 'Period: DEC 2026', x: 20, y: 20 },
        { text: 'Category: NYC-220-B', x: 30, y: 20 },
        ...dates,
        ...rows,
      ],
    },
  ]);

// A pilot row laid out exactly like a real one (header at x=383): training
// Fri Dec 4 18:59 - Sun Dec 6 13:38, then a trip Dec 8 19:00 - Dec 10 22:01.
const pilotRow = [
  { text: '14870 / 000000000', x: 383, y: 46.9 },
  { text: 'PILOT NAME', x: 389, y: 46.9 },
  { text: 'Cr:071:11', x: 395, y: 46.9 },
  { text: 'Days Off: 18', x: 401, y: 46.9 },
  { text: '18:59', x: 384, y: 174.3 },
  { text: '015:00', x: 396, y: 174.3 },
  { text: '10WD', x: 402, y: 174.3 },
  { text: '13:38', x: 390, y: 214.8 },
  { text: 'RDU', x: 378, y: 255.3 },
  { text: '19:00', x: 384, y: 255.3 },
  { text: '015:45', x: 396, y: 255.3 },
  { text: '8085', x: 402, y: 255.3 },
  { text: 'B', x: 408, y: 255.3 },
  { text: '22:01', x: 390, y: 295.8 },
  // Carry-out trip: "Jan1" beside the release time past day 31.
  { text: '16:51', x: 384, y: 680.7 },
  { text: '009:06', x: 396, y: 680.7 },
  { text: '7682', x: 402, y: 680.7 },
  { text: 'Jan1', x: 384, y: 741.5 },
  { text: '14:48', x: 390, y: 741.5 },
];

test('wide schedule blocks carry start, release and end day', () => {
  const [line] = report(pilotRow).lines;
  assert.deepEqual(line.events, [
    {
      day: 4,
      type: 'training',
      code: '10WD',
      creditHours: 15,
      checkInTime: '18:59',
      releaseTime: '13:38',
      endDay: 6,
    },
    {
      day: 8,
      type: 'pairing',
      code: '8085',
      creditHours: 15.75,
      checkInTime: '19:00',
      releaseTime: '22:01',
      endDay: 10,
    },
    {
      day: 29,
      type: 'pairing',
      code: '7682',
      creditHours: 9.1,
      checkInTime: '16:51',
      releaseTime: '14:48',
      endDay: 32,
    },
  ]);
});

test('open-time rows, whose columns sit 6pt left, still read credit and times', () => {
  const [line] = report([
    { text: 'Open-1', x: 347, y: 46.9 },
    { text: '05:00', x: 342, y: 457.9 },
    { text: '017:50', x: 354, y: 457.9 },
    { text: '7662', x: 360, y: 457.9 },
    { text: '16:46', x: 348, y: 498.4 },
  ]).lines;
  assert.deepEqual(line.events, [
    {
      day: 18,
      type: 'pairing',
      code: '7662',
      creditHours: 17.833333333333332,
      checkInTime: '05:00',
      releaseTime: '16:46',
      endDay: 20,
    },
  ]);
});

test('a line becomes calendar items: training, linked trips, merged reserve days', () => {
  const items = buildLineCalendarItems(
    [
      {
        day: 1,
        type: 'reserve',
        code: 'RES',
        checkInTime: '00:00',
        releaseTime: '23:59',
        endDay: 1,
      },
      {
        day: 2,
        type: 'reserve',
        code: 'RES',
        checkInTime: '00:00',
        releaseTime: '23:59',
        endDay: 2,
      },
      {
        day: 3,
        type: 'reserve',
        code: 'RES',
        checkInTime: '00:00',
        releaseTime: '23:59',
        endDay: 3,
      },
      {
        day: 4,
        type: 'training',
        code: '10WD',
        creditHours: 15,
        checkInTime: '18:59',
        releaseTime: '13:38',
        endDay: 6,
      },
      {
        day: 8,
        type: 'pairing',
        code: '8085',
        creditHours: 15.75,
        checkInTime: '19:00',
        releaseTime: '22:01',
        endDay: 10,
      },
      {
        day: 15,
        type: 'pairing',
        code: '9999',
        checkInTime: '06:00',
        releaseTime: '12:00',
        endDay: 15,
      },
    ],
    (code, day) => (code === '8085' && day === 8 ? 501 : null)
  );
  assert.deepEqual(
    items.map(item => [
      item.kind,
      item.code,
      item.day,
      item.endDay,
      item.pairingId,
    ]),
    [
      ['reserve', 'RES', 1, 3, null],
      ['training', '10WD', 4, 6, null],
      ['pairing', '8085', 8, 10, 501],
      ['pairing', '9999', 15, 15, null],
    ]
  );
  assert.equal(items[1].creditHours, 15);
});
