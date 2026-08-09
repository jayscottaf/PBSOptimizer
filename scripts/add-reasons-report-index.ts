/**
 * Adds the (base, year, month) index to reasons_report_preferences.
 *
 * Every Trends / Bid-Patterns query filters this table by `base` first;
 * the table had no indexes at all, so each was a sequential scan over the
 * whole table. /api/trends fires 5 such queries per page load,
 * /api/bid-patterns 7.
 *
 * CONCURRENTLY so it never takes a write lock on a live table. That means
 * it cannot run inside a transaction — hence the raw execute rather than
 * drizzle-kit push (which this project deliberately never uses).
 *
 * Local:      npx tsx scripts/add-reasons-report-index.ts
 * Production: DATABASE_URL="<prod url>" npx tsx scripts/add-reasons-report-index.ts
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const before = await db.execute(sql`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'reasons_report_preferences'
  `);
  console.log(
    'Indexes before:',
    before.rows.map((r: any) => r.indexname).join(', ') || '(none)'
  );

  console.log('Creating index (CONCURRENTLY, no write lock)...');
  await db.execute(sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS
      reasons_report_preferences_base_year_month_idx
    ON reasons_report_preferences (base, year, month)
  `);

  const after = await db.execute(sql`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'reasons_report_preferences'
  `);
  console.log(
    'Indexes after:',
    after.rows.map((r: any) => r.indexname).join(', ')
  );

  const counts = await db.execute(sql`
    SELECT COUNT(*)::int AS rows, COUNT(DISTINCT base)::int AS bases
    FROM reasons_report_preferences
  `);
  console.log('Table:', counts.rows[0]);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
