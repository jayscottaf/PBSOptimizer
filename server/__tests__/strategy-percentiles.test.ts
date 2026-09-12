import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { sql } from 'drizzle-orm';
import { db, cleanup } from '../db';
import { pilotRosterCtes } from '../lib/pilot-roster';
import { percentileWithin } from '../lib/empiricalHold';

after(cleanup);

// Read-only VALUES fixture: does not read or change application records.
test('preference counts cannot change pilot rank and SQL agrees with hold evidence', async () => {
  const ranks = pilotRosterCtes(sql`fixture`, sql``);
  const result = await db.execute(sql`
    WITH fixture AS (
      SELECT 2026 AS year, 'AUG' AS month, 100 AS pilot_seniority_number
      FROM generate_series(1, 100)
      UNION ALL SELECT 2026, 'AUG', 200
      UNION ALL SELECT 2026, 'AUG', 300
      UNION ALL SELECT 2026, 'SEP', 200
    ), ${ranks}
    SELECT month, pilot_seniority_number, pct FROM pilot_ranks
    ORDER BY month, pilot_seniority_number
  `);
  assert.equal(result.rows.length, 4);
  for (const row of result.rows) {
    const roster = row.month === 'AUG' ? [100, 200, 300] : [200];
    assert.equal(
      Math.round(Number(row.pct) * 1000) / 10,
      percentileWithin(roster, Number(row.pilot_seniority_number))
    );
  }
  assert.equal(
    Number(result.rows[1].pct),
    0.667,
    "middle pilot follows roster, not the senior pilot's 100 preferences"
  );
});
