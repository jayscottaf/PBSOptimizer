import { sql, type SQL } from 'drizzle-orm';

/** One vote per pilot, using the same <= roster percentile as percentileWithin. */
export function pilotRosterCtes(source: SQL, filter: SQL): SQL {
  return sql`pilot_roster AS (
    SELECT DISTINCT year, month, pilot_seniority_number
    FROM ${source}
    WHERE pilot_seniority_number IS NOT NULL ${filter}
  ), pilot_ranks AS (
    SELECT year, month, pilot_seniority_number,
      round((cume_dist() OVER (
        PARTITION BY year, month ORDER BY pilot_seniority_number
      ) * 1000)::numeric) / 1000 AS pct
    FROM pilot_roster
  )`;
}
