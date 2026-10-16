import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import { registerBidReviewRoutes } from '../routes/bid-review';
import { storage } from '../storage';
import { cleanup } from '../db';

after(cleanup);
const html = `<title>NYC-220-B NOV 2026 Composite Report</title><body>
Seniority 100 Category NYC-220-B TEST 000000100
1. Pairing Bid Group
2. Prefer Off Nov 26, 2026
Honored
Seniority 200 Category NYC-220-B OTHER 000000200
1. Pairing Bid Group
2. Prefer Off Friday
Honored
</body>`;

test('review route confirms identity across monthly seniority changes and never writes profile data', async () => {
  const primary = storage.getPrimaryUser,
    profile = storage.getBidProfile;
  const app = express();
  registerBidReviewRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as any).port}/api/bid/review`;
  const form = () => {
    const data = new FormData();
    data.set('mode', 'results');
    data.set('seniorityNumber', '200');
    data.set(
      'reasonsReport',
      new Blob([html], { type: 'text/html' }),
      'synthetic.htm'
    );
    return data;
  };
  try {
    storage.getPrimaryUser = async () => ({ id: 1 }) as any;
    storage.getBidProfile = async () => ({ employeeNumber: '00100' }) as any;
    const res = await fetch(url, { method: 'POST', body: form() });
    const first = await res.json();
    assert.equal(res.status, 200, JSON.stringify(first));
    assert.equal(first.review.pilot.seniorityNumber, 100);
    storage.getBidProfile = async () => undefined;
    const response = await fetch(url, { method: 'POST', body: form() });
    const choices = await response.json();
    assert.equal(choices.needsPilotSelection, true);
    assert.equal(choices.review, undefined);
    assert.equal(choices.pilots.length, 2);
    const selected = form();
    selected.set('pilotSelected', 'true');
    const chosen = await (
      await fetch(url, { method: 'POST', body: selected })
    ).json();
    assert.equal(chosen.review.pilot.seniorityNumber, 200);
    const before = new FormData();
    before.set('mode', 'before');
    before.set('bidText', '1. Pairing Bid Group\n2. Award Pairings');
    const check = await (
      await fetch(url, { method: 'POST', body: before })
    ).json();
    assert.equal(check.review.mode, 'before');
    const bad = new FormData();
    bad.set('mode', 'results');
    assert.equal((await fetch(url, { method: 'POST', body: bad })).status, 400);
  } finally {
    storage.getPrimaryUser = primary;
    storage.getBidProfile = profile;
    await new Promise<void>((resolve, reject) =>
      server.close(err => (err ? reject(err) : resolve()))
    );
  }
});

test('saved report API reviews existing records without a file and rejects missing/ambiguous sources', async () => {
  const originals = {
    list: storage.getBidReviewReports,
    load: storage.getStoredBidReviewReport,
    primary: storage.getPrimaryUser,
    profile: storage.getBidProfile,
  };
  const saved = {
    id: 'saved-nov',
    month: 'NOV',
    year: 2026,
    base: 'NYC',
    aircraft: '220-B',
    preferenceCount: 1,
    awardCount: 0,
  };
  const app = express();
  registerBidReviewRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const root = `http://127.0.0.1:${(server.address() as any).port}/api/bid/review`;
  const form = (id = 'saved-nov') => {
    const data = new FormData();
    data.set('mode', 'results');
    data.set('savedReport', id);
    return data;
  };
  try {
    storage.getBidReviewReports = async () => [saved];
    storage.getStoredBidReviewReport = async report => {
      assert.equal(report.id, saved.id);
      return {
        awards: [],
        preferences: [
          {
            month: 'NOV',
            year: 2026,
            base: 'NYC',
            aircraft: '220-B',
            pilotSeniorityNumber: 100,
            pilotEmployeeNumber: '000000100',
            preferenceNumber: 2,
            preferenceText: 'Prefer Off Nov 26, 2026',
            outcome: 'Honored',
            outcomeDetail: null,
            awardedPairingNumbers: [],
            reportBanners: ['Bid Group 1: Reserve Bid Group'],
          },
        ] as any,
      };
    };
    storage.getPrimaryUser = async () => ({ id: 1 }) as any;
    storage.getBidProfile = async () => ({ employeeNumber: '100' }) as any;
    const list = await fetch(root + '/reports');
    assert.equal(list.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await list.json(), [saved]);
    const response = await fetch(root, { method: 'POST', body: form() });
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    assert.equal(data.review.period, 'NOV 2026');
    assert.equal(data.review.pilot.seniorityNumber, 100);
    assert.ok(
      data.review.limitations.some((l: string) => l.includes('Older imports'))
    );
    assert.equal(
      (await fetch(root, { method: 'POST', body: form('gone') })).status,
      404
    );
    const both = form();
    both.set('reasonsReport', new Blob([html]), 'extra.htm');
    assert.equal(
      (await fetch(root, { method: 'POST', body: both })).status,
      400
    );
    storage.getBidProfile = async () => undefined;
    const selection = await (
      await fetch(root, { method: 'POST', body: form() })
    ).json();
    assert.equal(selection.needsPilotSelection, true);
    const chosen = form();
    chosen.set('pilotSelected', 'true');
    chosen.set('seniorityNumber', '100');
    assert.equal(
      (await (await fetch(root, { method: 'POST', body: chosen })).json())
        .review.pilot.seniorityNumber,
      100
    );
    const loadWithGroups = storage.getStoredBidReviewReport;
    storage.getStoredBidReviewReport = async report => {
      const rows = await loadWithGroups(report);
      return {
        ...rows,
        preferences: rows.preferences.map(row => ({
          ...row,
          reportBanners: [],
        })),
      };
    };
    const incomplete = await (
      await fetch(root, { method: 'POST', body: chosen })
    ).json();
    assert.deepEqual(incomplete.review.groups, []);
    assert.equal(
      incomplete.review.summary.find((s: any) => s.label === 'Awarded group')
        .value,
      'Not retained'
    );
    storage.getStoredBidReviewReport = async () => ({
      awards: [],
      preferences: [],
    });
    const old = await fetch(root, { method: 'POST', body: form() });
    assert.equal(old.status, 400);
    assert.match((await old.json()).message, /awards only/);
    storage.getBidReviewReports = async () => {
      throw new Error('injected unavailable database');
    };
    assert.equal((await fetch(root + '/reports')).status, 500);
  } finally {
    storage.getBidReviewReports = originals.list;
    storage.getStoredBidReviewReport = originals.load;
    storage.getPrimaryUser = originals.primary;
    storage.getBidProfile = originals.profile;
    await new Promise<void>((resolve, reject) =>
      server.close(err => (err ? reject(err) : resolve()))
    );
  }
});
