import { sql } from 'drizzle-orm';
import { db } from '../db';
import { normalizedAircraftSqlExpr, parseAircraftCode } from './aircraft';
import { normalizeMonth3, percentileWithin } from './empiricalHold';
import type { CategorySeniority } from '../../shared/category-seniority';

const months = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];

export function calculateCategorySeniority(
  periods: Array<{ month: string; year: number; seniorities: number[] }>,
  seniorityNumber: number
): CategorySeniority | null {
  const valid = periods
    .map(period => ({
      ...period,
      month: normalizeMonth3(period.month),
      seniorities: [
        ...new Set(
          period.seniorities
            .map(Number)
            .filter(n => Number.isInteger(n) && n > 0)
        ),
      ].sort((a, b) => a - b),
    }))
    .filter(
      period =>
        period.month &&
        Number.isInteger(period.year) &&
        period.seniorities.length
    );
  valid.sort(
    (a, b) =>
      b.year - a.year || months.indexOf(b.month!) - months.indexOf(a.month!)
  );
  const latest = valid[0];
  if (!latest) return null;
  return {
    percentile: percentileWithin(latest.seniorities, seniorityNumber),
    seniorOrEqual: latest.seniorities.filter(n => n <= seniorityNumber).length,
    totalPilots: latest.seniorities.length,
    month: latest.month!,
    year: latest.year,
  };
}

export async function getCategorySeniority(
  input: {
    base: string;
    aircraft: string;
    position: 'A' | 'B';
    seniorityNumber: number;
  },
  executor: Pick<typeof db, 'execute'> = db
): Promise<CategorySeniority | null> {
  const fleet = parseAircraftCode(input.aircraft).baseType;
  // Require an explicit seat: unclassified records must not mix captains and FOs.
  const result = await executor.execute(sql`
    SELECT upper(left(trim(month), 3)) AS month, year,
      array_agg(DISTINCT pilot_seniority_number ORDER BY pilot_seniority_number) AS seniorities
    FROM reasons_report_preferences
    WHERE upper(trim(base)) = ${input.base}
      AND ${sql.raw(normalizedAircraftSqlExpr('aircraft'))} = ${fleet}
      AND right(upper(regexp_replace(aircraft, '\\s+', '', 'g')), 1) = ${input.position}
      AND pilot_seniority_number > 0
    GROUP BY upper(left(trim(month), 3)), year
  `);
  return calculateCategorySeniority(
    result.rows as Array<{
      month: string;
      year: number;
      seniorities: number[];
    }>,
    input.seniorityNumber
  );
}
