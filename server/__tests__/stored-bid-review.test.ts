import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { sql } from 'drizzle-orm';
import { db, cleanup } from '../db';
import { storage } from '../storage';
import { restoreBidReview, reviewBanners } from '../lib/stored-bid-review';
import { ReasonsReportParser } from '../reasonsReportParser';
import { reviewResults } from '../lib/bid-review';
import { bidHistory, reasonsReportPreferences } from '../../shared/schema';
after(cleanup);
const metadata = { month: 'NOV', year: 2026, base: 'TEST', aircraft: '220-B' };
const pane = ReasonsReportParser.parseReasonsPane(`<body>
Seniority 100 Category TEST-220-B SYNTHETIC 000000100
Minimum window &lt;062:00&gt; Threshold &lt;062:00&gt; Maximum window &lt;072:00&gt;
Affected By Denial Mode
1. Pairing Bid Group (Reduced Regular Line)
Max Reduced Regular Lines Reached
2. Prefer Off Sunday
10. Pairing Bid Group
11. Award Pairings
1000 2026-11-03 06:00 2026-11-05 12:00 (048:36)
(1 Awarded, 1 Matching, Running total: 048:36)
Award Pairings
1001 2026-11-29 06:00 2026-11-30 23:59 (013:33)
(1 Awarded, 1 Matching, Running total: 062:09)
20. Reserve Bid Group
21. Prefer Off Nov 26, 2026
</body>`);
const records = pane.preferences.map((pref, i) => ({
  id: i + 1,
  ...metadata,
  pilotSeniorityNumber: pref.pilotSeniorityNumber,
  pilotEmployeeNumber: pref.pilotEmployeeNumber,
  preferenceNumber: pref.preferenceNumber,
  preferenceText: pref.preferenceText,
  outcome: pref.outcome,
  outcomeDetail: pref.outcomeDetail,
  awardedPairingNumbers: pref.awardedPairingNumbers,
  reportBanners: reviewBanners(pref, pane.banners),
  uploadedAt: new Date(),
}));
const awards = ['1000', '1001'].map((pairingNumber, i) => ({
  id: i + 1,
  ...metadata,
  pairingNumber,
  juniorHolderSeniority: 100,
  juniorHolderName: 'SYNTHETIC',
  juniorHolderEmployeeNumber: '000000100',
  awardType: 'Regular',
  pairingDays: 3,
  creditHours: i ? '13.55' : '48.60',
  totalCredit: null,
  checkInDate: i ? '11/29 Sun 06:00' : '11/03 Tue 06:00',
  checkOutDate: '11/30 Mon 23:59',
  layoverCities: null,
  linkedPairingId: null,
  layoverCitiesFromPackage: null,
  turnDestination: null,
  legSignature: null,
  tripFingerprint: null,
  awardedAt: new Date('2026-11-01'),
  uploadedAt: new Date(),
}));
test('saved choices retain the same review, minute totals, fallback source and pilot/group flags', () => {
  const restored = restoreBidReview(records, awards);
  const result = reviewResults({ metadata, ...restored });
  assert.equal(restored.legacyPilots.size, 0);
  assert.equal(
    result.summary.find(s => s.label === 'Month credit')?.value,
    '62:09'
  );
  assert.equal(
    result.groups[0].status,
    'Unavailable: reduced-line quota filled'
  );
  assert.equal(result.groups[2].status, 'Not reached after the awarded group');
  assert.equal(result.awards[1].source, 'Automatic fallback');
  assert.ok(result.findings.some(f => f.title === 'PBS used Denial Mode'));
  assert.equal(result.pilot?.name, 'SYNTHETIC');
});
test('older report-wide flags never become personal flags and fallback events still restore', () => {
  const legacy = records.map(r => ({
    ...r,
    reportBanners: (r.reportBanners as string[]).filter(
      b => !b.startsWith('Pilot ') && !b.startsWith('Group status: ')
    ),
  }));
  const restored = restoreBidReview(legacy, awards);
  assert.ok(restored.legacyPilots.has(100));
  assert.deepEqual(restored.preferences[0].pilotBanners, []);
  const result = reviewResults({ metadata, ...restored });
  assert.ok(!result.findings.some(f => f.title === 'PBS used Denial Mode'));
  assert.equal(result.awards[1].source, 'Automatic fallback');
});
test('saved report SQL lists reserve/legacy reports, sorts months and isolates exact category and year', async () => {
  await db.transaction(async tx => {
    for (const name of ['bid_history', 'reasons_report_preferences']) {
      await tx.execute(
        sql.raw(
          `CREATE TEMP TABLE ${name} (LIKE public.${name} INCLUDING DEFAULTS) ON COMMIT DROP`
        )
      );
    }
    await tx
      .insert(reasonsReportPreferences)
      .values([
        ...records,
        { ...records[0], id: 50, month: 'OCT' },
        { ...records[0], id: 51, aircraft: '220-A' },
        { ...records[0], id: 52, year: 2025 },
        { ...records[0], id: 53, base: 'OTHER' },
      ]);
    await tx
      .insert(bidHistory)
      .values([...awards, { ...awards[0], id: 60, month: 'DEC' }]);
    const reports = await storage.getBidReviewReports(tx as any);
    assert.equal(reports.length, 6);
    assert.equal(reports[0].month, 'DEC');
    const chosen = reports.find(
      r =>
        r.base === 'TEST' &&
        r.aircraft === '220-B' &&
        r.month === 'NOV' &&
        r.year === 2026
    )!;
    assert.equal(chosen.awardCount, 2);
    assert.equal(chosen.preferenceCount, records.length);
    const loaded = await storage.getStoredBidReviewReport(chosen, tx as any);
    assert.equal(loaded.preferences.length, records.length);
    assert.equal(loaded.awards.length, 2);
    assert.ok(
      loaded.preferences.every(
        r =>
          r.month === 'NOV' &&
          r.aircraft === '220-B' &&
          r.year === 2026 &&
          r.base === 'TEST'
      )
    );
    assert.equal(reports[0].preferenceCount, 0);
    assert.equal(reports.find(r => r.aircraft === '220-A')?.awardCount, 0);
  });
});
