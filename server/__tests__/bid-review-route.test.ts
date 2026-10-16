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
