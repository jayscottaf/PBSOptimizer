/**
 * Re-derives each bid package's month/year label from its stored bid period.
 *
 * A package is named for the month owning most of its period. The parser used
 * to take the period's START month, which is right for the common
 * "May 2 – Jun 1" shape but wrong for "Aug 31 – Sep 30" (one day in August),
 * so packages of the second shape were labeled a month early. This fixes rows
 * already in the database; the parser fix only helps future uploads.
 *
 * Dry run (default, writes nothing):
 *   npx tsx scripts/fix-bid-package-months.ts
 * Apply:
 *   npx tsx scripts/fix-bid-package-months.ts --apply
 * Production:
 *   DATABASE_URL="<prod url>" npx tsx scripts/fix-bid-package-months.ts --apply
 */
import { db } from '../server/db';
import { bidPackages } from '../shared/schema';
import { eq } from 'drizzle-orm';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Parse "YYYY-MM-DD" as local parts; Date(string) would read it as UTC. */
function parseDate(value: unknown): Date | null {
  const m = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const rows = await db.select().from(bidPackages);
  console.log(`${rows.length} bid packages\n`);

  let changed = 0;
  let skipped = 0;

  for (const pkg of rows) {
    const start = parseDate(pkg.bidPeriodStart);
    const end = parseDate(pkg.bidPeriodEnd);
    if (!start || !end) {
      console.log(
        `  #${pkg.id} ${pkg.month} ${pkg.year} — no bid period stored, skipping`
      );
      skipped++;
      continue;
    }
    // Midpoint lands in the month holding most of the period, for both shapes.
    const mid = new Date((start.getTime() + end.getTime()) / 2);
    const month = MONTH_NAMES[mid.getMonth()];
    const year = mid.getFullYear();

    if (pkg.month === month && pkg.year === year) {
      continue;
    }
    console.log(
      `  #${pkg.id} ${pkg.base} ${pkg.aircraft}: ` +
        `${pkg.month} ${pkg.year} -> ${month} ${year} ` +
        `(period ${pkg.bidPeriodStart} .. ${pkg.bidPeriodEnd})`
    );
    changed++;
    if (apply) {
      await db
        .update(bidPackages)
        .set({ month, year })
        .where(eq(bidPackages.id, pkg.id));
    }
  }

  console.log(
    `\n${changed} package(s) ${apply ? 'updated' : 'would change'}` +
      (skipped ? `, ${skipped} skipped (no period)` : '')
  );
  if (changed > 0 && !apply) {
    console.log('Re-run with --apply to write these changes.');
  }
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
