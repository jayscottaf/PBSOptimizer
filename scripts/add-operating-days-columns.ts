/**
 * Adds operating_dows and except_dates to the pairings table.
 *
 * A pairing operates on a subset of its effective range — the header names
 * the weekdays it flies ("TU TH SA") and a separate clause lists dates it
 * skips ("EXCEPT AUG 13 ..."). Neither was captured, so the simulator
 * treated every day in the range as operable.
 *
 * Both columns are nullable and additive, so existing rows and older code
 * keep working until scripts/backfill-operating-days.ts fills them in.
 * Raw SQL rather than drizzle-kit push (this project never uses push).
 *
 * Local:      npx tsx scripts/add-operating-days-columns.ts
 * Production: DATABASE_URL="<prod url>" npx tsx scripts/add-operating-days-columns.ts
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const before = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'pairings'
      AND column_name IN ('operating_dows', 'except_dates')
  `);
  console.log(
    'existing:',
    before.rows.map((r: any) => r.column_name).join(', ') || '(neither)'
  );

  await db.execute(sql`
    ALTER TABLE pairings ADD COLUMN IF NOT EXISTS operating_dows jsonb
  `);
  await db.execute(sql`
    ALTER TABLE pairings ADD COLUMN IF NOT EXISTS except_dates jsonb
  `);

  const after = await db.execute(sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'pairings'
      AND column_name IN ('operating_dows', 'except_dates')
    ORDER BY column_name
  `);
  console.log('after:');
  for (const r of after.rows as any[]) {
    console.log(`  ${r.column_name} ${r.data_type}`);
  }
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
