/**
 * Backtest: would the optimizer have beaten the pilot's real bid?
 *
 * For every period that has (a) an ingested bid package, (b) the pilot's
 * own Reasons preference rows, and (c) the pilot's actual awarded
 * pairings, this:
 *   1. Learns the pilot's profile from all OTHER periods (leave-one-out —
 *      the optimizer never peeks at the month being tested).
 *   2. Runs the optimizer on that month's package at the pilot's actual
 *      seniority percentile that month.
 *   3. Compares the optimizer's predicted line vs the actually-held line
 *      on credit and on profile-fit score (both scored by the SAME
 *      leave-one-out profile, so neither side is favored).
 *
 * Honest caveats printed with results: optimizer credit is
 * probability-weighted expectation, actuals are realized; reserve months
 * make actual pairing credit low by design. Usage:
 *   npx tsx scripts/backtest-optimizer.ts <employeeNumber> [base]
 */

import { db } from '../server/db';
import { sql } from 'drizzle-orm';
import { storage } from '../server/storage';
import { learnProfile } from '../server/lib/profileLearner';
import { optimizeBid, scorePairings } from '../server/lib/bidOptimizer';
import { simulateBid } from '../server/lib/bidSimulator';

const MONTH_NAME_TO_CODE: Record<string, string> = {
  January: 'JAN', February: 'FEB', March: 'MAR', April: 'APR',
  May: 'MAY', June: 'JUN', July: 'JUL', August: 'AUG',
  September: 'SEP', October: 'OCT', November: 'NOV', December: 'DEC',
};

async function main() {
  const employeeNumber = process.argv[2] || '050000600';
  const base = process.argv[3] || 'NYC';
  const coreEmpNo = employeeNumber.replace(/^0+/, '').replace(/00$/, '');

  const { rows: allRows } = await storage.getPilotPreferenceRows(employeeNumber);
  if (allRows.length === 0) {
    console.error(`No reasons history for employee ${employeeNumber}`);
    process.exit(1);
  }

  const packages = await db.execute(sql`
    SELECT id, month, year FROM bid_packages
    WHERE base = ${base} AND status = 'completed' ORDER BY year, id
  `);

  const trends = await storage.getTrendsSummary(base);
  const window = await storage.getCategoryCreditWindow(base).catch(() => null);

  const results: any[] = [];
  for (const pkg of packages.rows as any[]) {
    const code = MONTH_NAME_TO_CODE[String(pkg.month)] ?? String(pkg.month).slice(0, 3).toUpperCase();
    const periodKey = `${code} ${pkg.year}`;

    // Actual awarded line that month
    const actual = await db.execute(sql`
      SELECT pairing_number, credit_hours FROM bid_history
      WHERE base = ${base} AND month = ${code} AND year = ${pkg.year}
        AND junior_holder_employee_number = ${coreEmpNo}
    `);
    if (actual.rows.length === 0) continue;

    const testRows = allRows.filter(r => `${r.month} ${r.year}` === periodKey);
    const trainRows = allRows.filter(r => `${r.month} ${r.year}` !== periodKey);
    if (testRows.length === 0 || trainRows.length === 0) continue;
    const trainPeriods = new Set(trainRows.map(r => `${r.month} ${r.year}`)).size;
    const { weights } = learnProfile(trainRows, trainPeriods);

    // Pilot percentile that month, from the period roster
    const roster = await db.execute(sql`
      SELECT DISTINCT pilot_seniority_number FROM reasons_report_preferences
      WHERE base = ${base} AND month = ${code} AND year = ${pkg.year}
        AND pilot_seniority_number IS NOT NULL
      ORDER BY pilot_seniority_number
    `);
    const mine = await db.execute(sql`
      SELECT DISTINCT pilot_seniority_number FROM reasons_report_preferences
      WHERE base = ${base} AND month = ${code} AND year = ${pkg.year}
        AND ltrim(pilot_employee_number,'0') = ltrim(${employeeNumber},'0')
    `);
    const rosterNums = (roster.rows as any[]).map(r => Number(r.pilot_seniority_number));
    const myNum = Number((mine.rows as any[])[0]?.pilot_seniority_number);
    const percentile = rosterNums.length && myNum
      ? (rosterNums.filter(n => n <= myNum).length / rosterNums.length) * 100
      : undefined;

    // Boundaries from all OTHER periods (no peeking at the test month)
    const boundaryByDays = new Map<number, number>();
    for (const b of trends.holdBoundaries) {
      if (b.period === periodKey || b.juniorMostPercentile === null) continue;
      boundaryByDays.set(b.pairingDays, Math.max(
        boundaryByDays.get(b.pairingDays) ?? 0,
        b.juniorMostPercentile
      ));
    }

    const pkgPairings = await storage.searchPairings({ bidPackageId: pkg.id });
    const optimized = optimizeBid(pkgPairings, weights, {
      seniorityPercentile: percentile,
      holdBoundaries: [...boundaryByDays.entries()].map(
        ([pairingDays, juniorMostPercentile]) => ({ pairingDays, juniorMostPercentile })
      ),
      threshold: window?.threshold ?? undefined,
    });
    const sim = simulateBid(optimized.bid, pkgPairings, {
      threshold: window?.threshold,
      windowMin: window?.windowMin,
      windowMax: window?.windowMax,
    });

    // Score both lines with the SAME profile
    const scored = scorePairings(pkgPairings, weights);
    const scoreOf = (num: string) => scored.find(s => s.pairingNumber === num)?.score;
    const predScores = sim.awards.map(a => scoreOf(a.pairingNumber)).filter((x): x is number => x !== undefined);
    const actualNums = (actual.rows as any[]).map(r => String(r.pairing_number));
    const actScores = actualNums.map(scoreOf).filter((x): x is number => x !== undefined);
    const actualCredit = (actual.rows as any[]).reduce((s, r) => s + parseFloat(String(r.credit_hours)), 0);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

    results.push({
      period: periodKey,
      pct: percentile?.toFixed(0),
      optAwards: sim.awards.length,
      optExpCredit: sim.expectedCredit.toFixed(1),
      optFit: avg(predScores)?.toFixed(3),
      actAwards: actualNums.length,
      actCredit: actualCredit.toFixed(1),
      actFit: avg(actScores)?.toFixed(3) ?? 'n/a(pairings not in pkg)',
      fitEdge: avg(predScores) !== null && avg(actScores) !== null
        ? ((avg(predScores)! - avg(actScores)!) >= 0 ? '+' : '') + (avg(predScores)! - avg(actScores)!).toFixed(3)
        : 'n/a',
    });
  }

  console.log(`\nBacktest for employee ${employeeNumber} (${base}) — leave-one-out profile learning`);
  console.table(results);
  console.log(`
Caveats:
- optExpCredit is hold-probability-weighted expectation; actCredit is realized.
- Months where the pilot held reserve show few actual pairings by design.
- fitEdge = optimizer avg profile-fit minus actual avg profile-fit, scored
  by the same leave-one-out profile (positive = optimizer picked pairings
  that fit the pilot's own revealed preferences better).`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
