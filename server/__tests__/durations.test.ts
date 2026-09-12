import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { sql } from 'drizzle-orm';
import { db, cleanup } from '../db';
import {
  printedDurationMinutes,
  decimalHoursToMinutes,
  formatDuration,
  printedDurationHours,
} from '../../shared/durations';
import { printedDurationMinutesSql } from '../lib/duration-sql';
import { ReasonsReportParser } from '../reasonsReportParser';

after(cleanup);

test('printed durations and explicit decimal hours have distinct minute-accurate meanings', () => {
  assert.equal(printedDurationHours('18:30'), 18.5);
  assert.equal(printedDurationMinutes('10.30'), 630);
  assert.equal(printedDurationMinutes('10:30'), 630);
  assert.equal(printedDurationMinutes('10'), 600);
  assert.equal(decimalHoursToMinutes('10.30'), 618);
  assert.equal(formatDuration(decimalHoursToMinutes('18.50')), '18.30');
  assert.ok(Number.isNaN(printedDurationMinutes('10.60')));
  const fingerprint = ReasonsReportParser.createTripFingerprint({
    pairingNumber: '1001',
    pilotName: 'Synthetic',
    seniorityNumber: 1,
    employeeNumber: 'test',
    awardType: 'Regular',
    pairingDays: 1,
    monthCredit: '18:45',
    totalCredit: '18:45',
    layoverCities: 'BOS-14',
    checkInDate: '08/01 Sat 09:00',
    checkOutDate: '08/03 Mon 12:00',
  });
  assert.equal(fingerprint.efficiencyBucket, 18.5);
});

test('PostgreSQL filtering/sorting uses the same minutes as client filtering', async () => {
  const values = ['10.30', '10:30', '10', '10.60', '', ' 100.53 '];
  const expr = printedDurationMinutesSql(sql`duration`);
  const result = await db.execute(
    sql`SELECT duration, ${expr} AS minutes, (${expr} >= 630 AND ${expr} <= 630) AS exact FROM (VALUES ${sql.join(
      values.map(value => sql`(${value}::text)`),
      sql`, `
    )}) AS fixture(duration)`
  );
  for (const row of result.rows) {
    const expected = printedDurationMinutes(row.duration as string);
    assert.equal(
      row.minutes === null ? null : Number(row.minutes),
      Number.isNaN(expected) ? null : expected
    );
    if (expected === 630) assert.equal(row.exact, true);
  }
});
