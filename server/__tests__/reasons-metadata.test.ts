import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReasonsReportParser } from '../reasonsReportParser';

test('extracts metadata for numeric and alphanumeric fleet codes', () => {
  assert.deepEqual(
    ReasonsReportParser.extractMetadata(
      '<title>NYC-220-B OCT 2026 Composite Report</title>'
    ),
    { base: 'NYC', aircraft: '220-B', month: 'OCT', year: 2026 }
  );

  assert.deepEqual(
    ReasonsReportParser.extractMetadata(
      '<title>NYC-7ER-B OCT\u00a02025 Composite Report</title>'
    ),
    { base: 'NYC', aircraft: '7ER-B', month: 'OCT', year: 2025 }
  );
});

test('preserves explicit category standing on parsed preferences', () => {
  const pane = ReasonsReportParser.parseReasonsPane(`<body>
    Seniority 14985 Category NYC-220-B MERGL 050000600
    Minimum window &lt;062:00&gt; Threshold &lt;082:00&gt; Maximum window &lt;082:00&gt;
    Category:73/165 Regular:70/129 Reserve:3(above)/36
    2. Award Pairings If Departing On Monday
    Honored
  </body>`);
  assert.equal(
    pane.preferences[0].standingInfo,
    'Standing Category 73/165, Regular 70/129, Reserve 3 above/36'
  );
});

test('preserves bid group order and reduced-line mode', () => {
  const pane = ReasonsReportParser.parseReasonsPane(`<body>
    Seniority 14985 Category NYC-220-B MERGL 050000600
    1. Pairing Bid Group (Reduced Regular Line)
    2. Avoid Pairings If Pairing Check-In Station EWR Else Start Next Bid Group
    11. Pairing Bid Group
    12. Prefer Off Friday, Saturday, Sunday
    Honored
  </body>`);
  assert.equal(
    pane.preferences[0].bidGroupInfo,
    'Bid Group 1: Pairing Bid Group (Reduced Regular Line)'
  );
  assert.equal(
    pane.preferences[1].bidGroupInfo,
    'Bid Group 2: Pairing Bid Group'
  );
});

test('preserves pre-awards with dates and credit', () => {
  const pane = ReasonsReportParser.parseReasonsPane(`<body>
    Seniority 14985 Category NYC-220-B MERGL 050000600
    Pre-Awards
    SVAC 2026-09-30 00:00 2026-10-05 23:59 (020:00)
    7762 2026-09-25 12:55 2026-09-25 20:52 (000:00)
    (2 Pre-Awarded, Running total: 020:00)
    &lt;&lt; Current Bid &gt;&gt;
    1. Pairing Bid Group
    2. Award Pairings If Pairing Number 8098
    Honored
  </body>`);
  assert.deepEqual(pane.preferences[0].preAwardInfo, [
    'Pre-Award SVAC | 2026-09-30 00:00 | 2026-10-05 23:59 | 020:00',
    'Pre-Award 7762 | 2026-09-25 12:55 | 2026-09-25 20:52 | 000:00',
  ]);
});

test('preserves all exclusion reasons and separates the automatic fallback pool', () => {
  const pane = ReasonsReportParser.parseReasonsPane(`<body>
    Seniority 14985 Category NYC-220-B MERGL synthetic
    11. Pairing Bid Group
    12. Avoid Pairings If Pairing Check-In Station EWR
    Honored
    20. Award Pairings If Departing On Monday
    If Pairing Length = 4 days
    Awarded to senior bidder: 8
    Item overlaps with another: 1
    Filtered by bid number 12: 2
    (0 Awarded, 11 Matching, Running total: 062:59)
    Award Pairings
    Awarded to senior bidder: 220
    Violates bid number 13: 63
    Filtered by bid number 12: 64
    (0 Awarded, 449 Matching, Running total: 062:59)
    21. Pairing Bid Group
    22. Prefer Off Saturday, Sunday
    Honored
  </body>`);
  const row = pane.preferences.find(p => p.preferenceNumber === 20)!;
  assert.match(row.preferenceText, /If Pairing Length = 4 days$/);
  assert.match(row.outcomeDetail!, /Item overlaps with another: 1/);
  assert.match(row.outcomeDetail!, /Filtered by bid number 12: 2/);
  assert.match(row.outcomeDetail!, /\nAutomatic Award Pairings:\n/);
  assert.match(row.outcomeDetail!, /Violates bid number 13: 63/);
  assert.equal(
    pane.preferences.find(p => p.preferenceNumber === 22)?.outcomeDetail,
    null
  );
});

test('does not classify Not honored as Honored', () => {
  const pane = ReasonsReportParser.parseReasonsPane(`<body>
    2. Prefer Off Saturday, Sunday
    Not honored
  </body>`);
  assert.equal(pane.preferences[0].outcome, 'Not honored');
});
