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
