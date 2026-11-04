import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  renderColumnAwarePage,
  type PageTextItem,
} from '../lib/column-page-text';

const PAGE_WIDTH = 612;
const LEFT_X = 11;
const RIGHT_X = 313;
const at = (str: string, x: number, y: number): PageTextItem => ({
  str,
  transform: [1, 0, 0, 1, x, y],
});

// Two pairings side by side, as Delta prints them (abridged).
const leftColumn = [
  at(' #7737  SU   EFFECTIVE AUG03 ONLY   CHECK-IN AT 13.32', LEFT_X, 741),
  at('  A      2895    EWR 1432  MSP 1629  2.57', LEFT_X, 731),
  at('  TOTAL CREDIT 28.49TL  25.16BL', LEFT_X, 721),
];
const rightColumn = [
  at(' #7742  SA   EFFECTIVE AUG02 ONLY   CHECK-IN AT 13.59', RIGHT_X, 741),
  at('  A      2895    EWR 1459  MSP 1655  2.56', RIGHT_X, 731),
  at('  TOTAL CREDIT 21.50TL  17.59BL', RIGHT_X, 721),
];
const expectedColumns = [...leftColumn, ...rightColumn]
  .map(item => item.str)
  .join('\n');

test('reads a two-column pairing page left column first, then right', () => {
  assert.equal(
    renderColumnAwarePage([...leftColumn, ...rightColumn], 0, PAGE_WIDTH),
    expectedColumns
  );
});

test('does not interleave columns when the PDF stores text row by row', () => {
  const rowByRow = [0, 1, 2].flatMap(i => [leftColumn[i], rightColumn[i]]);
  assert.equal(
    renderColumnAwarePage(rowByRow, 0, PAGE_WIDTH),
    expectedColumns
  );
});

test('reads non-pairing pages (cover, ALV table) row by row across the page', () => {
  const alvTable = [
    at('NYC', 40, 700),
    at('220', 120, 700),
    at('B', 200, 700),
    at('76.35', 400, 700),
    at('NYC', 40, 690),
    at('220', 120, 690),
    at('A', 200, 690),
    at('71.40', 400, 690),
  ];
  assert.equal(
    renderColumnAwarePage(alvTable, 0, PAGE_WIDTH),
    'NYC220B76.35\nNYC220A71.40'
  );
});

test('keeps a single-column page whole when only one half holds pairings', () => {
  const items = [
    ...leftColumn,
    at('Page 50', RIGHT_X + 200, 20),
  ];
  assert.equal(
    renderColumnAwarePage(items, 0, PAGE_WIDTH),
    [...leftColumn.map(item => item.str), 'Page 50'].join('\n')
  );
});

test('groups items within 2pt of each other onto one row, in x order', () => {
  assert.equal(
    renderColumnAwarePage(
      [at('CHECK-IN AT 13.32', 260, 740.5), at(' #7737  SU', LEFT_X, 741)],
      0,
      PAGE_WIDTH
    ),
    ' #7737  SUCHECK-IN AT 13.32'
  );
});
