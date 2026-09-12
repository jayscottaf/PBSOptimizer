import { sql, type SQL } from 'drizzle-orm';

/** SQL equivalent of shared printedDurationMinutes. Invalid values are NULL. */
export function printedDurationMinutesSql(value: SQL): SQL {
  const text = sql`trim(${value}::text)`;
  return sql`(CASE
    WHEN ${text} ~ '^[0-9]+([.:][0-5][0-9])?$' THEN
      split_part(replace(${text}, '.', ':'), ':', 1)::numeric * 60 +
      COALESCE(NULLIF(split_part(replace(${text}, '.', ':'), ':', 2), '')::numeric, 0)
    ELSE NULL END)`;
}
