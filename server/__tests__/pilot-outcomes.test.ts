import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { sql } from 'drizzle-orm';
import { cleanup, db } from '../db';
import { storage } from '../storage';

after(cleanup);

test('latest pilot outcomes preserve active group evidence', async () => {
  const originalExecute = db.execute;
  try {
    await db.transaction(async tx => {
      await tx.execute(sql`CREATE TEMP TABLE reasons_report_preferences (
        preference_number integer, preference_text text, outcome text,
        outcome_detail text, awarded_pairing_numbers jsonb, report_banners jsonb,
        month text, year integer, pilot_seniority_number integer,
        base text, aircraft text
      ) ON COMMIT DROP`);
      await tx.execute(sql`INSERT INTO reasons_report_preferences VALUES
        (2, 'Reduced line preference', 'Unknown', null, '[]',
          '["Bid Group 1: Pairing Bid Group (Reduced Regular Line)"]',
          'OCT', 2026, 14985, 'NYC', '220-B'),
        (12, 'Prefer Off Friday', 'Honored', null, '[]',
          '["Window 062:00-082:00, Threshold 082:00", "Pre-Award SVAC | 2026-09-30 00:00 | 2026-10-05 23:59 | 020:00", "Bid Group 2: Pairing Bid Group"]',
          'OCT', 2026, 14985, 'NYC', '220-B'),
        (17, 'Award Monday trips', 'Awarded to senior bidder',
          '11; (1 Awarded, 18 Matching, Running total: 012:43)', '["7900"]',
          '["Bid Group 2: Pairing Bid Group"]',
          'OCT', 2026, 14985, 'NYC', '220-B')`);
      db.execute = tx.execute.bind(tx) as typeof db.execute;
      const result = await storage.getLatestPilotOutcomes({
        seniorityNumber: 14985,
        base: 'NYC',
        aircraft: 'A220',
      });
      assert.equal(result.period, 'OCT 2026');
      assert.equal(
        result.creditWindow,
        'Window 062:00-082:00, Threshold 082:00'
      );
      assert.equal(result.preAwards.length, 1);
      assert.deepEqual(
        result.preferences.map(row => row.groupActive),
        [false, true, true]
      );
      assert.deepEqual(result.preferences[2].awardedPairingNumbers, ['7900']);
      assert.deepEqual(
        {
          awarded: result.preferences[2].awardedCount,
          matching: result.preferences[2].matchingCount,
          runningTotal: result.preferences[2].runningTotal,
          seniorBidders: result.preferences[2].seniorBidderCount,
        },
        {
          awarded: 1,
          matching: 18,
          runningTotal: '012:43',
          seniorBidders: 11,
        }
      );
    });
  } finally {
    db.execute = originalExecute;
  }
});
