import { sql, type SQL } from 'drizzle-orm';

export type HoldProbabilityUpdate = {
  id: number;
  holdProbability: number;
  reasoning?: string[];
};

// Builds a single bulk UPDATE statement that writes hold_probability and
// hold_probability_reasoning for many pairings at once using CASE expressions.
// Returns null when the input is empty so callers can skip the round-trip.
export function buildHoldProbabilityBulkUpdate(
  updates: HoldProbabilityUpdate[]
): SQL | null {
  if (updates.length === 0) {
    return null;
  }

  const probWhens = updates.map(
    u => sql`WHEN ${u.id} THEN ${u.holdProbability}`
  );

  const reasoningWhens = updates.map(u =>
    u.reasoning !== undefined
      ? sql`WHEN ${u.id} THEN ${JSON.stringify(u.reasoning)}::jsonb`
      : sql`WHEN ${u.id} THEN hold_probability_reasoning`
  );

  const ids = updates.map(u => sql`${u.id}`);

  return sql`UPDATE pairings SET hold_probability = CASE id ${sql.join(
    probWhens,
    sql.raw(' ')
  )} END, hold_probability_reasoning = CASE id ${sql.join(
    reasoningWhens,
    sql.raw(' ')
  )} END WHERE id IN (${sql.join(ids, sql`, `)})`;
}
