import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCategoryStanding } from '../lib/category-standing';

test('parses category, regular, and reserve standing totals', () => {
  assert.deepEqual(
    parseCategoryStanding(
      'Standing Category 73/165, Regular 70/129, Reserve 3 above/36'
    ),
    {
      categoryPosition: 73,
      categoryTotal: 165,
      regularPosition: 70,
      regularTotal: 129,
      reserveAbove: 3,
      reserveTotal: 36,
    }
  );
  assert.equal(parseCategoryStanding('Window 062:00-082:00'), null);
});
