/**
 * Backfills each pairing's real operating days from its stored PDF text.
 *
 * The parser used to drop three things: the effective-range END day (lost to
 * the "AUG. 29" period format), the header's weekday clause ("TU TH SA" =
 * only these, "EXCPT FR SA SU" = all but these), and the "EXCEPT <dates>"
 * skip list. Every pairing therefore looked like it operated on a single
 * date, or on every day of a guessed month.
 *
 * full_text_block retains the original text, so this re-derives all three
 * without re-uploading anything — favorites, bid history and hold
 * probabilities are untouched.
 *
 * Dry run (default, writes nothing):
 *   npx tsx scripts/backfill-operating-days.ts
 * Apply:
 *   npx tsx scripts/backfill-operating-days.ts --apply
 * Production:
 *   DATABASE_URL="<prod url>" npx tsx scripts/backfill-operating-days.ts --apply
 */
import { db } from '../server/db';
import { pairings } from '../shared/schema';
import { eq, sql } from 'drizzle-orm';
import {
  parseEffectiveRangeText,
  parseOperatingDays,
} from '../shared/operatingDays';

const NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function main() {
  const apply = process.argv.includes('--apply');
  const rows = await db
    .select({
      id: pairings.id,
      bidPackageId: pairings.bidPackageId,
      pairingNumber: pairings.pairingNumber,
      effectiveDates: pairings.effectiveDates,
      fullTextBlock: pairings.fullTextBlock,
    })
    .from(pairings);

  console.log(`${rows.length} pairings\n`);

  let changed = 0;
  let withDows = 0;
  let withExcept = 0;
  let rangeFixed = 0;
  const samples: string[] = [];

  for (const row of rows) {
    const block = row.fullTextBlock ?? '';
    const range = parseEffectiveRangeText(block);
    const { operatingDows, exceptDates } = parseOperatingDays(block);

    // Only overwrite the range when re-parsing actually found one; never
    // replace a good value with an empty string.
    const nextRange = range || row.effectiveDates;
    const rangeChanged = nextRange !== row.effectiveDates;
    const hasNew = operatingDows !== null || exceptDates.length > 0;
    if (!rangeChanged && !hasNew) {
      continue;
    }

    changed++;
    if (rangeChanged) rangeFixed++;
    if (operatingDows !== null) withDows++;
    if (exceptDates.length > 0) withExcept++;

    if (samples.length < 8) {
      samples.push(
        `  #${row.pairingNumber} (pkg ${row.bidPackageId}): ` +
          `${JSON.stringify(row.effectiveDates)} -> ${JSON.stringify(nextRange)}` +
          (operatingDows
            ? ` | days ${operatingDows.map(d => NAMES[d]).join('/')}`
            : ' | days ANY') +
          (exceptDates.length ? ` | except ${exceptDates.join(', ')}` : '')
      );
    }

    if (apply) {
      await db
        .update(pairings)
        .set({
          effectiveDates: nextRange,
          operatingDows: operatingDows,
          exceptDates: exceptDates,
        })
        .where(eq(pairings.id, row.id));
    }
  }

  console.log('samples:');
  for (const s of samples) console.log(s);
  console.log(
    `\n${changed} pairing(s) ${apply ? 'updated' : 'would change'}` +
      `\n  ${rangeFixed} with a corrected effective range` +
      `\n  ${withDows} with a weekday restriction` +
      `\n  ${withExcept} with skipped dates`
  );
  if (changed > 0 && !apply) {
    console.log('\nRe-run with --apply to write these changes.');
  }
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
