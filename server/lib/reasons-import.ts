import { and, eq, sql } from 'drizzle-orm';
import { awardIdentity } from './award-identity';
import { db } from '../db';
import {
  bidHistory,
  reasonsReportPreferences,
  type InsertReasonsReportPreference,
} from '../../shared/schema';
import type { ReasonsReportMetadata } from '../reasonsReportParser';

export async function persistReasonsImport(
  input: {
    metadata: ReasonsReportMetadata;
    awards: (typeof bidHistory.$inferInsert)[];
    preferences: InsertReasonsReportPreference[];
  },
  database: Pick<typeof db, 'transaction'> = db
) {
  return database.transaction(async tx => {
    const { metadata } = input;
    // Serialize the report's read/dedupe/write across server instances.
    // An in-process mutex would not protect concurrent serverless uploads.
    const reportKey = JSON.stringify([
      metadata.base,
      metadata.aircraft,
      metadata.year,
      metadata.month,
    ]);
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${reportKey}, 0))`
    );
    const existing = await tx
      .select({
        id: bidHistory.id,
        creditHours: bidHistory.creditHours,
        totalCredit: bidHistory.totalCredit,
        pairingNumber: bidHistory.pairingNumber,
        juniorHolderSeniority: bidHistory.juniorHolderSeniority,
        juniorHolderEmployeeNumber: bidHistory.juniorHolderEmployeeNumber,
        checkInDate: bidHistory.checkInDate,
      })
      .from(bidHistory)
      .where(
        and(
          eq(bidHistory.month, metadata.month),
          eq(bidHistory.year, metadata.year),
          eq(bidHistory.base, metadata.base),
          eq(bidHistory.aircraft, metadata.aircraft)
        )
      );
    const keys = new Set(existing.map(awardIdentity));
    const previous = new Map(existing.map(row => [awardIdentity(row), row]));
    const corrections = new Map<number, typeof bidHistory.$inferInsert>();
    const awards = input.awards.filter(row => {
      if (!row.checkInDate?.trim())
        throw new Error('Award check-in date is required');
      const key = awardIdentity(row);
      if (keys.has(key)) {
        const old = previous.get(key);
        if (
          old &&
          (Math.round(Number(old.creditHours) * 100) !==
            Math.round(Number(row.creditHours) * 100) ||
            Math.round(Number(old.totalCredit ?? 0) * 100) !==
              Math.round(Number(row.totalCredit ?? 0) * 100))
        ) {
          corrections.set(old.id, row);
        }
        return false;
      }
      keys.add(key);
      return true;
    });
    let storedCount = 0;
    let linkedCount = 0;
    let refreshedCount = 0;
    // Authoritative re-imports can repair old credit without deleting awards,
    // links, or non-credit fingerprint fields. Batch the updates atomically.
    const updates = [...corrections.entries()];
    for (let i = 0; i < updates.length; i += 500) {
      const values = updates.slice(i, i + 500).map(([id, row]) => {
        const credit = Number(row.creditHours);
        const fingerprint = JSON.stringify({
          creditHours: credit,
          creditBucket: Math.floor(credit / 2) * 2,
          efficiencyBucket: Math.floor((credit / row.pairingDays) * 2) / 2,
        });
        return sql`(${id}::integer, ${row.creditHours}::numeric, ${row.totalCredit ?? null}::numeric, ${fingerprint}::jsonb)`;
      });
      const changed = await tx.execute(sql`UPDATE ${bidHistory} AS b SET
        credit_hours = c.credit, total_credit = c.total,
        trip_fingerprint = COALESCE(b.trip_fingerprint, '{}'::jsonb) || c.fingerprint
        FROM (VALUES ${sql.join(values, sql`, `)}) AS c(id, credit, total, fingerprint)
        WHERE b.id = c.id RETURNING b.id`);
      if (changed.rows.length !== values.length)
        throw new Error('Award correction count mismatch');
      refreshedCount += changed.rows.length;
    }
    for (let i = 0; i < awards.length; i += 500) {
      const chunk = awards.slice(i, i + 500);
      const stored = await tx
        .insert(bidHistory)
        .values(chunk)
        .returning({ linkedPairingId: bidHistory.linkedPairingId });
      if (stored.length !== chunk.length)
        throw new Error('Award insert count mismatch');
      storedCount += stored.length;
      linkedCount += stored.filter(r => r.linkedPairingId !== null).length;
    }
    let preferencesParsed = 0;
    if (input.preferences.length > 0) {
      await tx
        .delete(reasonsReportPreferences)
        .where(
          and(
            eq(reasonsReportPreferences.month, metadata.month),
            eq(reasonsReportPreferences.year, metadata.year),
            eq(reasonsReportPreferences.base, metadata.base),
            eq(reasonsReportPreferences.aircraft, metadata.aircraft)
          )
        );
      for (let i = 0; i < input.preferences.length; i += 200) {
        const chunk = input.preferences.slice(i, i + 200);
        const stored = await tx
          .insert(reasonsReportPreferences)
          .values(chunk)
          .returning({ id: reasonsReportPreferences.id });
        if (stored.length !== chunk.length)
          throw new Error('Preference insert count mismatch');
        preferencesParsed += stored.length;
      }
    }
    return {
      storedCount,
      refreshedCount,
      skippedCount: input.awards.length - awards.length - refreshedCount,
      linkedCount,
      unlinkedCount: storedCount - linkedCount,
      preferencesParsed,
    };
  });
}
