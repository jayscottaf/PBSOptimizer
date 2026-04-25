/**
 * Smoke test for the hold-probability bulk-update SQL builder.
 *
 * Verifies the produced statement covers all input ids, includes both CASE
 * expressions, and parameterizes scalar values (no literal interpolation).
 */

import { buildHoldProbabilityBulkUpdate } from '../holdProbabilityUpdate';

describe('buildHoldProbabilityBulkUpdate', () => {
  it('returns null for empty input', () => {
    expect(buildHoldProbabilityBulkUpdate([])).toBeNull();
  });

  it('produces a single UPDATE with both CASE branches and an IN list', () => {
    const stmt = buildHoldProbabilityBulkUpdate([
      { id: 1, holdProbability: 87, reasoning: ['weekend off'] },
      { id: 2, holdProbability: 42, reasoning: ['low credit'] },
      { id: 3, holdProbability: 10 },
    ]);

    expect(stmt).not.toBeNull();
    const { sql, params } = (
      stmt as { toSQL: () => { sql: string; params: unknown[] } }
    ).toSQL();

    expect(sql).toMatch(/UPDATE pairings/);
    expect(sql).toMatch(/hold_probability = CASE id/);
    expect(sql).toMatch(/hold_probability_reasoning = CASE id/);
    expect(sql).toMatch(/WHERE id IN/);
    // Row with no reasoning should preserve the existing column value.
    expect(sql).toMatch(/THEN hold_probability_reasoning/);

    // Each id appears in both CASE arms and once in the IN list = 3 occurrences.
    expect(params).toEqual(
      expect.arrayContaining([
        1,
        87,
        '["weekend off"]',
        2,
        42,
        '["low credit"]',
        3,
        10,
      ])
    );
  });
});
