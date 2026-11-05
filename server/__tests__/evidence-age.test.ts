import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  computeEmpiricalHold,
  describeEvidenceAge,
} from '../lib/empiricalHold';

test('names the newest evidence period and its age before the package', () => {
  const age = describeEvidenceAge(
    [
      { month: 'MAY', year: 2026 },
      { month: 'JUL', year: 2026 },
      { month: 'AUG', year: 2025 },
    ],
    { month: 'September', year: 2026 }
  );
  assert.deepEqual(age, {
    text: 'newest JUL 2026 (2 months before this package)',
    monthsOld: 2,
    stale: false,
  });
});

test('counts months across a year boundary and flags evidence over a year old', () => {
  const age = describeEvidenceAge([{ month: 'NOV', year: 2024 }], {
    month: 'JAN',
    year: 2026,
  });
  assert.equal(age?.monthsOld, 14);
  assert.equal(age?.stale, true);
});

test('omits the age when the package period is unknown', () => {
  assert.equal(
    describeEvidenceAge([{ month: 'JUL', year: 2026 }])?.text,
    'newest JUL 2026'
  );
  assert.equal(describeEvidenceAge([]), null);
});

// 100-pilot rosters: seniority number N is the Nth percentile.
const roster = Array.from({ length: 100 }, (_, i) => i + 1);
const matchesFrom = (periods: Array<[string, number]>) =>
  periods.map(([month, year]) => ({
    seniorityNumber: 60,
    month,
    year,
    similarity: 90,
  }));

test('hold explanations lead with the evidence age', () => {
  const periods: Array<[string, number]> = [
    ['MAY', 2026],
    ['JUN', 2026],
    ['JUL', 2026],
  ];
  const result = computeEmpiricalHold({
    userPercentile: 40,
    matches: matchesFrom(periods),
    rosters: new Map(periods.map(([m, y]) => [`${m}-${y}`, roster])),
    bidMonth: 'August',
    bidYear: 2026,
  });
  assert.match(
    result!.reasoning[0],
    /newest JUL 2026 \(1 month before this package\)$/
  );
});

test('stale evidence lowers the stated confidence', () => {
  const periods: Array<[string, number]> = [
    ['FEB', 2023],
    ['MAR', 2023],
    ['APR', 2023],
    ['MAY', 2023],
    ['JUN', 2023],
    ['JUL', 2023],
  ];
  const result = computeEmpiricalHold({
    userPercentile: 40,
    matches: matchesFrom(periods),
    rosters: new Map(periods.map(([m, y]) => [`${m}-${y}`, roster])),
    bidMonth: 'August',
    bidYear: 2026,
  });
  const text = result!.reasoning.join('\n');
  assert.match(text, /Lower confidence: the newest evidence is 37 months old/);
  assert.doesNotMatch(text, /High confidence/);
});
