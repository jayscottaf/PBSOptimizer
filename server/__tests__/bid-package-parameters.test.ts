import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBidCategoryParameters } from '../lib/bid-package-parameters';
import { findBidCategoryParameters } from '../../shared/bid-package-parameters';

const table = `
Category ALV LOW HIGH GUAR RULE 3-Day VAC Slide LIM
NYC 220 A 74:51 64:51-84:51 72:51 3-99-5 Yes 133
NYC 220 B 72:00 62:00-82:00 72:00 3-99-5 Yes 130
NYC 330 B 75:27 65:27-85:27 73:27 4-99-4 No 262
`;

test('parses all published category parameters from the bid package table', () => {
  const rows = parseBidCategoryParameters(table);
  const row = findBidCategoryParameters(rows, 'nyc', 'A220-B', 'B');

  assert.equal(rows.length, 3);
  assert.deepEqual(row, {
    base: 'NYC',
    aircraft: '220',
    position: 'B',
    alvHours: 72,
    lineConstructionMinHours: 62,
    lineConstructionMaxHours: 82,
    reserveGuaranteeHours: 72,
    reserveRule: '3-99-5',
    extraXDay: true,
    vacationSlide: true,
    rllLimit: 130,
    displayName: 'NYC 220 B',
  });
});

test('keeps independent seat parameters and No eligibility flags', () => {
  const rows = parseBidCategoryParameters(table);
  const row = findBidCategoryParameters(rows, 'NYC', '330', 'B');

  assert.equal(row?.alvHours, 75.45);
  assert.equal(row?.reserveGuaranteeHours, 73.45);
  assert.equal(row?.extraXDay, false);
  assert.equal(row?.vacationSlide, false);
  assert.equal(row?.rllLimit, 262);
});
