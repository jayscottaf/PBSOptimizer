import { analysisCategory } from '../../shared/category-key';
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

/** Read-only what-if comparisons; never update the pilot's saved position. */
export async function getCategoryComparisons(
  seniorityNumber: number,
  executor: Pick<typeof db, 'execute'> = db
): Promise<import('../../shared/category-seniority').CategoryComparison[]> {
  const result = await executor.execute(sql`
    SELECT upper(trim(base)) AS base,
      ${sql.raw(normalizedAircraftSqlExpr('aircraft'))} AS aircraft,
      right(upper(regexp_replace(aircraft, '\\s+', '', 'g')), 1) AS position,
      upper(left(trim(month), 3)) AS month, year,
      array_agg(DISTINCT pilot_seniority_number ORDER BY pilot_seniority_number) AS seniorities
    FROM reasons_report_preferences
    WHERE pilot_seniority_number > 0
      AND upper(regexp_replace(aircraft, '\\s+', '', 'g')) ~ '[AB]$'
    GROUP BY 1, 2, 3, 4, 5
  `);
  type Period = {
    base: string;
    aircraft: string;
    position: 'A' | 'B';
    month: string;
    year: number;
    seniorities: number[];
  };
  const categories = new Map<string, Period[]>();
  for (const row of result.rows as Period[]) {
    const key = `${row.base}|${row.aircraft}|${row.position}`;
    const periods = categories.get(key) ?? [];
    periods.push(row);
    categories.set(key, periods);
  }
  return [...categories.values()]
    .flatMap(periods => {
      const seniority = calculateCategorySeniority(periods, seniorityNumber);
      const { base, aircraft, position } = periods[0];
      return seniority ? [{ base, aircraft, position, ...seniority }] : [];
    })
    .sort((a, b) =>
      `${a.base}|${a.aircraft}|${a.position}`.localeCompare(
        `${b.base}|${b.aircraft}|${b.position}`
      )
    );
}

/** Never apply a saved fleet's percentile to a different package category. */
export async function getAnalysisSeniority(
  user: { seniorityNumber: number; aircraft: string } | null | undefined,
  bidPackage: { base: string; aircraft: string } | null | undefined,
  executor: Pick<typeof db, 'execute'> = db
): Promise<number> {
  if (!user || !bidPackage) return 50;
  const category = analysisCategory(
    bidPackage.base,
    bidPackage.aircraft,
    user.aircraft
  );
  const roster = await getCategorySeniority(
    { ...category, seniorityNumber: user.seniorityNumber },
    executor
  );
  return roster?.percentile ?? 50;
}
