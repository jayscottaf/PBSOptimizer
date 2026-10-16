import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseBidDocument,
  reviewBefore,
  reviewResults,
} from '../lib/bid-review';
import { ReasonsReportParser } from '../reasonsReportParser';

const html = `<title>NYC-220-B NOV 2026 Composite Report</title><body>
Seniority 100 Category NYC-220-B SYNTHETIC 000100
Minimum window &lt;062:00&gt; Threshold &lt;062:00&gt; Maximum window &lt;072:00&gt;
Affected By Denial Mode
1. Pairing Bid Group (Reduced Regular Line)
Max Reduced Regular Lines Reached
2. Avoid Pairings If Pairing Check-In Station EWR Else Start Next Bid Group
10. Pairing Bid Group
11. Prefer Off Nov 26, 2026
Honored
12. Award Pairings If Pairing Length = 3 days
1000 2026-11-03 06:00 2026-11-05 12:00 (048:36)
Awarded to senior bidder: 4
Filtered by bid number 11: 5
(1 Awarded, 10 Matching, Running total: 048:36)
Award Pairings
1001 2026-11-29 06:00 2026-11-30 23:59 (013:33)
Schedule is complete: 30
(1 Awarded, 31 Matching, Running total: 062:09)
20. Reserve Bid Group
21. Prefer Off Nov 7, 2026, Nov 8, 2026, Nov 9, 2026
</body>`;
const preferences = ReasonsReportParser.parseReasonsPane(html).preferences;
const metadata = { base: 'NYC', aircraft: '220-B', month: 'NOV', year: 2026 };
const awards = [
  {
    pairingNumber: '1000',
    pilotName: 'SYNTHETIC',
    seniorityNumber: 100,
    employeeNumber: '000100',
    awardType: 'Regular',
    pairingDays: 3,
    monthCredit: '48:36',
    totalCredit: '48:36',
    layoverCities: '',
    checkInDate: '11/03 Tue 06:00',
    checkOutDate: '11/05 Thu 12:00',
  },
  {
    pairingNumber: '1001',
    pilotName: 'SYNTHETIC',
    seniorityNumber: 100,
    employeeNumber: '000100',
    awardType: 'Regular',
    pairingDays: 2,
    monthCredit: '13:33',
    totalCredit: '13:33',
    layoverCities: '',
    checkInDate: '11/29 Sun 06:00',
    checkOutDate: '11/30 Mon 23:59',
  },
];

test('reviews the processed bid without requiring a printed confirmation', () => {
  const review = reviewResults({ metadata, preferences, awards });
  assert.equal(
    review.summary.find(s => s.label === 'Month credit')?.value,
    '62:09'
  );
  assert.equal(
    review.groups[0].status,
    'Unavailable: reduced-line quota filled'
  );
  assert.equal(review.groups[2].status, 'Not reached after the awarded group');
  assert.match(review.awards[1].source, /fallback/);
  assert.ok(review.findings.some(f => f.title === 'PBS used Denial Mode'));
  assert.ok(review.findings.some(f => f.title.includes('excluded 5')));
});

test('flags only real bid changes and does not grade unused reserve preferences', () => {
  const document = parseBidDocument(
    `Bid Period: NOV 2026\nConfirmation # Bids Modified\n1. Pairing Bid Group (Reduced Regular Line)\n2. Avoid Pairings If Pairing Check-In Station EWR Else Start Next Bid Group\n10. Pairing Bid Group\n11. Prefer Off Nov 26, 2026\n12. Award Pairings If Pairing Length = 3 Days\n20. Reserve Bid Group\n21. Prefer Off Nov 1, 2026`
  );
  const review = reviewResults({ metadata, preferences, awards, document });
  assert.deepEqual(
    review.comparisons.map(c => c.number),
    [21]
  );
  assert.equal(review.groups[2].status, 'Not reached after the awarded group');
  assert.ok(!review.findings.some(f => f.title.includes('failed')));
});

test('never compares documents from different months', () => {
  const document = parseBidDocument(
    'Bid Period: OCT 2026\n1. Pairing Bid Group\n2. Award Pairings'
  );
  const review = reviewResults({ metadata, preferences, awards, document });
  assert.equal(review.comparisons.length, 0);
  assert.ok(review.findings.some(f => f.title.includes('different period')));
});

test('does not infer successful credit or completion from absent data', () => {
  const review = reviewResults({
    metadata,
    preferences: [{ ...preferences[0], windowInfo: null }],
    awards: [],
  });
  assert.equal(
    review.summary.find(s => s.label === 'Month credit')?.value,
    'Not reported'
  );
  assert.equal(
    review.summary.find(s => s.label === 'Awarded group')?.value,
    'Not established'
  );
});

test('preflight catches conflicting station bids, late conditions and missing exits', () => {
  const document = parseBidDocument(
    'Start Pairings\nAvoid Pairings If Pairing Check-In Station EWR\nAward Pairings If Pairing Check-In Station EWR\nSet Condition Minimum Credit\nStart Reserve\nPrefer Off Nov 26, 2026'
  );
  const result = reviewBefore(document);
  assert.equal(result.groups.length, 2);
  assert.ok(result.findings.some(f => f.title.includes('conflicts')));
  assert.ok(result.findings.some(f => f.title.includes('after an Award')));
  assert.ok(result.findings.some(f => f.title.includes('exit')));
});

test('keeps wrapped dates and rejects empty, unrecognized bid documents', () => {
  const document = parseBidDocument(
    'Bid Period: NOV 2026\n1 Pairing Bid Group\n2 Prefer Off Nov\n14, 2026, Nov 15, 2026\n3 Unsupported instruction\nPairing Bid Group\nAward Pairings\nReserve Bid Group'
  );
  assert.match(document.lines[1].text, /Nov 14, 2026, Nov 15, 2026/);
  assert.equal(document.lines.length, 3);
  assert.ok(
    reviewBefore(document).findings.some(f => f.title.includes('not checked'))
  );
  assert.throws(
    () => reviewBefore(parseBidDocument('Some unrelated document')),
    /No recognizable/
  );
});

test('does not mark later groups skipped when the reported minimum has not been met', () => {
  const changed = preferences.map(p => ({
    ...p,
    windowInfo: 'Window 062:30-072:00, Threshold 062:30',
  }));
  const review = reviewResults({ metadata, preferences: changed, awards });
  assert.notEqual(
    review.groups[2].status,
    'Not reached after the awarded group'
  );
});
