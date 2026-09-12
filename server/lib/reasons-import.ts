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
    const awards = input.awards.filter(row => {
      if (!row.checkInDate?.trim())
        throw new Error('Award check-in date is required');
      const key = awardIdentity(row);
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    });
    let storedCount = 0;
    let linkedCount = 0;
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
      skippedCount: input.awards.length - awards.length,
      linkedCount,
      unlinkedCount: storedCount - linkedCount,
      preferencesParsed,
    };
  });
}
