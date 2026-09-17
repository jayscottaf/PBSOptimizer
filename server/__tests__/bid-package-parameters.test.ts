import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attachCarryOutCreditAllocations,
  parseBidCategoryParameters,
  parseCarryOutCreditAllocations,
} from '../lib/bid-package-parameters';
import { findBidCategoryParameters } from '../../shared/bid-package-parameters';
import { constructPatternLine } from '../lib/lineConstructor';

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

test('parses and attaches exact current-month and carry-out credit by date', () => {
  const report = `
BASE     : NYC                       DELTA AIRLINES
EQP      : 220                 TRIP CARRYOUT CREDIT REPORT
TRIP# SEAT      FLT  DATE  TIME        FLT  DATE  TIME   TAFB  TOTAL CURR   C/O
7661   AB       1641 10/30 06:00 DH    2012 11/01 17:00 061:30 17:34 11:13 06:21
7662   AB DH    1641 10/31 06:00       2012 11/02 17:00 061:30 17:34 04:32 13:02
`;
  const allocations = parseCarryOutCreditAllocations(report);
  const rows = attachCarryOutCreditAllocations(
    parseBidCategoryParameters(table),
    allocations
  );
  const row = findBidCategoryParameters(rows, 'NYC', '220', 'B');

  assert.equal(allocations.length, 2);
  assert.equal(allocations[0].totalCreditHours, 17 + 34 / 60);
  assert.equal(allocations[0].currentMonthCreditHours, 11 + 13 / 60);
  assert.equal(allocations[0].carryOutCreditHours, 6 + 21 / 60);
  assert.equal(row?.carryOutCreditAllocations?.length, 2);
});

test('line construction uses the date-specific current-month credit', () => {
  const result = constructPatternLine({
    candidates: [
      {
        pairingNumber: '7662',
        creditHours: 17 + 34 / 60,
        pairingDays: 3,
        holdProbability: 80,
        prefIndex: 0,
        instances: [{ startDay: 1, endDay: 3, creditHours: 4 + 32 / 60 }],
      },
    ],
    pattern: { minOn: 1, maxOn: 31, gap: 0 },
    window: { min: 4, max: 5 },
    threshold: 4,
  });

  assert.equal(result.feasible, true);
  assert.equal(result.placed[0].creditHours, 4 + 32 / 60);
  assert.equal(result.bestCredit, 4 + 32 / 60);
});
