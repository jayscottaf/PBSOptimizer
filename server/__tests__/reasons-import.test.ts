import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import { sql } from 'drizzle-orm';
import { db, cleanup } from '../db';
import { persistReasonsImport } from '../lib/reasons-import';
import { bidHistory, reasonsReportPreferences } from '../../shared/schema';
import { storage } from '../storage';
import { registerRoutes } from '../routes';

after(cleanup);

const metadata = { month: 'AUG', year: 2026, base: 'TEST', aircraft: '220-B' };
const award = (pairingNumber: string) => ({
  ...metadata,
  pairingNumber,
  juniorHolderSeniority: 100,
  pairingDays: 3,
  creditHours: '18.50',
  tripFingerprint: { layoverPattern: 'BOS' },
  awardedAt: new Date('2026-08-01T00:00:00Z'),
  checkInDate: '08/01 Sat 09:00',
});

test('the upload endpoint returns a failure when its transaction fails', async () => {
  const transaction = db.transaction;
  const getPackages = storage.getBidPackages;
  try {
    db.transaction = async () => {
      throw new Error('Injected transaction failure');
    };
    storage.getBidPackages = async () => [];
    const app = express();
    await registerRoutes(app);
    const route = app._router.stack.find(
      (layer: any) => layer.route?.path === '/api/upload-reasons-report'
    ).route;
    const cells = [
      '1001',
      '08/01 Sat 09:00',
      '08/03 Mon 18:00',
      '3',
      '18:30',
      '18:30',
      'BOS',
      '100',
      'synthetic',
      'Synthetic pilot',
      'Regular',
    ];
    const html = `<title>NYC-220-B AUG 2026 Composite Report</title><table><tbody><tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr></tbody></table>`;
    let status = 200;
    let body: any;
    const response = {
      status(code: number) {
        status = code;
        return this;
      },
      json(value: any) {
        body = value;
        return this;
      },
    };
    await route.stack
      .at(-1)
      .handle(
        { file: { originalname: 'synthetic.html', buffer: Buffer.from(html) } },
        response
      );
    assert.equal(status, 500);
    assert.equal(body.code, 'REASONS_PROCESSING_FAILED');
    assert.notEqual(body.success, true);
  } finally {
    db.transaction = transaction;
    storage.getBidPackages = getPackages;
  }
});
const preference = (preferenceText: string) => ({
  ...metadata,
  preferenceNumber: 1,
  preferenceText,
  outcome: 'Honored',
});

test('imports roll back earlier batches and preference deletion; counts describe committed rows', async () => {
  // Session-local tables shadow application tables. Their identity sequences
  // are local too; public records and public sequences are never changed.
  await db.transaction(async tx => {
    for (const name of ['bid_history', 'reasons_report_preferences']) {
      await tx.execute(
        sql.raw(
          `CREATE TEMP TABLE ${name} (LIKE public.${name} INCLUDING DEFAULTS) ON COMMIT DROP`
        )
      );
      await tx.execute(
        sql.raw(`ALTER TABLE pg_temp.${name} ALTER COLUMN id DROP DEFAULT`)
      );
      await tx.execute(
        sql.raw(
          `ALTER TABLE pg_temp.${name} ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY`
        )
      );
    }
    await tx.execute(
      sql`ALTER TABLE pg_temp.bid_history ADD CHECK (pairing_number <> 'reject')`
    );
    await tx.execute(
      sql`ALTER TABLE pg_temp.reasons_report_preferences ADD CHECK (preference_text <> 'reject')`
    );
    await tx.insert(reasonsReportPreferences).values(preference('old'));
    const many = Array.from({ length: 501 }, (_, i) =>
      award(i === 500 ? 'reject' : String(i))
    );
    await assert.rejects(
      persistReasonsImport({ metadata, awards: many, preferences: [] }, tx)
    );
    assert.equal(
      (await tx.select().from(bidHistory)).length,
      0,
      'first successful batch rolls back with second failed batch'
    );
    await assert.rejects(
      persistReasonsImport(
        {
          metadata,
          awards: [award('1001')],
          preferences: [preference('reject')],
        },
        tx
      )
    );
    assert.equal(
      (await tx.select().from(bidHistory)).length,
      0,
      'awards roll back with preference failure'
    );
    assert.equal(
      (await tx.select().from(reasonsReportPreferences))[0].preferenceText,
      'old',
      'previous outcomes survive replacement failure'
    );
    const result = await persistReasonsImport(
      { metadata, awards: [award('1001')], preferences: [preference('new')] },
      tx
    );
    assert.deepEqual(result, {
      storedCount: 1,
      refreshedCount: 0,
      skippedCount: 0,
      linkedCount: 0,
      unlinkedCount: 1,
      preferencesParsed: 1,
    });
    assert.equal(
      (await tx.select().from(reasonsReportPreferences))[0].preferenceText,
      'new'
    );
    const secondDate = { ...award('1001'), checkInDate: '08/07 Fri 09:00' };
    const repeated = await persistReasonsImport(
      {
        metadata,
        awards: [award('1001'), secondDate, secondDate],
        preferences: [],
      },
      tx
    );
    assert.equal(
      repeated.storedCount,
      1,
      'a second operating date is a distinct award'
    );
    assert.equal(
      repeated.skippedCount,
      2,
      'existing and within-report repeats stay idempotent'
    );
    const rerun = await persistReasonsImport(
      { metadata, awards: [award('1001'), secondDate], preferences: [] },
      tx
    );
    assert.equal(rerun.storedCount, 0);
    assert.equal((await tx.select().from(bidHistory)).length, 2);
    const correction = await persistReasonsImport(
      {
        metadata,
        awards: [
          { ...award('1001'), creditHours: '18.75', totalCredit: '18.75' },
        ],
        preferences: [],
      },
      tx
    );
    assert.equal(correction.refreshedCount, 1);
    assert.equal(correction.storedCount, 0);
    const corrected = (await tx.select().from(bidHistory)).find(
      row => row.checkInDate === '08/01 Sat 09:00'
    )!;
    assert.equal(corrected.creditHours, '18.75');
    assert.equal((corrected.tripFingerprint as any).creditHours, 18.75);
    assert.equal((corrected.tripFingerprint as any).layoverPattern, 'BOS');
    await assert.rejects(
      persistReasonsImport(
        {
          metadata,
          awards: [{ ...award('1001'), creditHours: '19.00' }],
          preferences: [preference('reject')],
        },
        tx
      )
    );
    assert.equal(
      (await tx.select().from(bidHistory)).find(row => row.id === corrected.id)!
        .creditHours,
      '18.75'
    );
    const reportKey = JSON.stringify([
      metadata.base,
      metadata.aircraft,
      metadata.year,
      metadata.month,
    ]);
    const competing = await db.execute(
      sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${reportKey}, 0)) AS acquired`
    );
    assert.equal(
      competing.rows[0].acquired,
      false,
      'another database session cannot race this report import'
    );
  });
});
