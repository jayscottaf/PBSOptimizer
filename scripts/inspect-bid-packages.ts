/**
 * Read-only diagnostic: list all bid packages with pairing counts and
 * flag likely duplicates (same base+month+year with differing aircraft
 * labels or overlapping content). Run against any DB via DATABASE_URL.
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const pkgs = await db.execute(sql`
    SELECT bp.id, bp.name, bp.month, bp.year, bp.base, bp.aircraft,
           bp.status, bp.uploaded_at,
           COUNT(p.id) AS pairing_count
    FROM bid_packages bp
    LEFT JOIN pairings p ON p.bid_package_id = bp.id
    GROUP BY bp.id
    ORDER BY bp.year, bp.month, bp.uploaded_at
  `);
  console.table(
    pkgs.rows.map((r: any) => ({
      id: r.id,
      month: r.month,
      year: r.year,
      base: r.base,
      aircraft: r.aircraft,
      status: r.status,
      pairings: r.pairing_count,
      uploaded: String(r.uploaded_at).slice(0, 19),
    }))
  );

  // For any base+month+year appearing more than once, compare pairing
  // number overlap between the copies.
  const dupGroups = await db.execute(sql`
    SELECT base, month, year, array_agg(id ORDER BY id) AS ids
    FROM bid_packages
    GROUP BY base, month, year
    HAVING COUNT(*) > 1
  `);
  for (const g of dupGroups.rows as any[]) {
    const ids: number[] = g.ids;
    console.log(`\nDuplicate group ${g.base} ${g.month} ${g.year}: ids ${ids.join(', ')}`);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const overlap = await db.execute(sql`
          SELECT
            (SELECT COUNT(*) FROM pairings WHERE bid_package_id = ${ids[i]}) AS count_a,
            (SELECT COUNT(*) FROM pairings WHERE bid_package_id = ${ids[j]}) AS count_b,
            (SELECT COUNT(*) FROM pairings a
              WHERE a.bid_package_id = ${ids[i]}
                AND EXISTS (SELECT 1 FROM pairings b
                            WHERE b.bid_package_id = ${ids[j]}
                              AND b.pairing_number = a.pairing_number)) AS shared
        `);
        const r: any = overlap.rows[0];
        console.log(
          `  ${ids[i]} vs ${ids[j]}: ${r.count_a} vs ${r.count_b} pairings, ${r.shared} shared pairing numbers`
        );
      }
    }
    // Which one do user favorites/calendar entries point at?
    for (const id of ids) {
      const refs = await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM user_favorites uf
            JOIN pairings p ON p.id = uf.pairing_id
            WHERE p.bid_package_id = ${id}) AS favorites,
          (SELECT COUNT(*) FROM user_calendar_events ce
            JOIN pairings p ON p.id = ce.pairing_id
            WHERE p.bid_package_id = ${id}) AS calendar_events
      `);
      const r: any = refs.rows[0];
      console.log(`  package ${id}: ${r.favorites} favorites, ${r.calendar_events} calendar events`);
    }
  }
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
