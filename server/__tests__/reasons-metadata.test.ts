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
