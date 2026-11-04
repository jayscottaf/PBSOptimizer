/**
 * Smoke test for the hold-probability bulk-update SQL builder.
 *
 * Verifies the produced statement covers all input ids, includes both CASE
 * expressions, and parameterizes scalar values (no literal interpolation).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { buildHoldProbabilityBulkUpdate } from '../holdProbabilityUpdate';

const render = (statement: SQL) => new PgDialect().sqlToQuery(statement);

test('returns null for empty input', () => {
  assert.equal(buildHoldProbabilityBulkUpdate([]), null);
});

test('produces a single UPDATE with both CASE branches and an IN list', () => {
  const statement = buildHoldProbabilityBulkUpdate([
    { id: 1, holdProbability: 87, reasoning: ['weekend off'] },
    { id: 2, holdProbability: 42, reasoning: ['low credit'] },
    { id: 3, holdProbability: 10 },
  ]);
  assert.ok(statement);
  const { sql, params } = render(statement);

  assert.match(sql, /UPDATE pairings/);
  assert.match(sql, /hold_probability = CASE id/);
  assert.match(sql, /hold_probability_reasoning = CASE id/);
  assert.match(sql, /WHERE id IN/);
  // Row with no reasoning should preserve the existing column value.
  assert.match(sql, /THEN hold_probability_reasoning/);
  // Values are bound parameters, never interpolated into the SQL text.
  assert.doesNotMatch(sql, /weekend off|low credit/);

  for (const value of [1, 87, '["weekend off"]', 2, 42, '["low credit"]', 3, 10]) {
    assert.ok(params.includes(value), `missing parameter ${String(value)}`);
  }
  // Each id is bound in both CASE arms and once in the IN list.
  assert.equal(params.filter(param => param === 3).length, 3);
});
