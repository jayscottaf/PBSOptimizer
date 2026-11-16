import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  describeLineItemWhen,
  lineItemTimes,
  lineItemTitle,
  type LineCalendarItem,
} from './line-calendar';

const dec2026 = { year: 2026, monthNumber: 12 };
// Training as printed for seniority 14870 on the NYC 220B DEC 2026 report.
const training: LineCalendarItem = {
  kind: 'training',
  code: '10WD',
  day: 4,
  endDay: 6,
  startTime: '18:59',
  releaseTime: '13:38',
  creditHours: 15,
  pairingId: null,
};

test('training runs from its start time to its release time', () => {
  const { start, end } = lineItemTimes(training, dec2026);
  assert.equal(start.toString(), new Date(2026, 11, 4, 18, 59).toString());
  assert.equal(end.toString(), new Date(2026, 11, 6, 13, 38).toString());
  assert.equal(
    describeLineItemWhen(training, dec2026),
    'Fri, Dec 4 18:59 – Sun, Dec 6 13:38'
  );
  assert.equal(lineItemTitle(training), '10WD');
});

test('a trip ending in the next month lands on Jan 1', () => {
  const { end } = lineItemTimes(
    {
      ...training,
      kind: 'pairing',
      code: '7682',
      day: 29,
      endDay: 32,
      releaseTime: '14:48',
    },
    dec2026
  );
  assert.equal(end.toString(), new Date(2027, 0, 1, 14, 48).toString());
});

test('a block without printed times covers its whole days', () => {
  const { start, end } = lineItemTimes(
    {
      ...training,
      kind: 'vacation',
      code: 'PVAC',
      startTime: null,
      releaseTime: null,
    },
    dec2026
  );
  assert.equal(start.getHours(), 0);
  assert.equal(end.getHours(), 23);
  assert.equal(end.getMinutes(), 59);
});

test('unlinked trips are titled by number', () => {
  assert.equal(
    lineItemTitle({ ...training, kind: 'pairing', code: '8085' }),
    'Trip 8085'
  );
});

test('manual credit accepts hours:minutes or decimal hours', async () => {
  const { parseCreditInput } = await import(
    '../components/add-calendar-event-dialog'
  );
  assert.equal(parseCreditInput('15:00'), 15);
  assert.equal(parseCreditInput('7:30'), 7.5);
  assert.equal(parseCreditInput('12.5'), 12.5);
  assert.equal(parseCreditInput(''), null);
  assert.equal(parseCreditInput('7:75'), null);
});
