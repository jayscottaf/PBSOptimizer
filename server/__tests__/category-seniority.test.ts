import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { sql } from 'drizzle-orm';
import { db, cleanup } from '../db';
import {
  calculateCategorySeniority,
  getCategorySeniority,
  getCategoryComparisons,
  getAnalysisSeniority,
} from '../lib/category-seniority';
import { categorySeniorityInput } from '../../shared/category-seniority';
import { categoryKey, analysisCategory } from '../../shared/category-key';
import { publicUser } from '../lib/access-control';

after(cleanup);

test('latest category roster is chronological, deduplicated and supports seniority between listed pilots', () => {
  const periods = [
    { month: 'DEC', year: 2025, seniorities: [1, 2] },
    { month: 'February', year: 2026, seniorities: [400, 100, 200, 200, 300] },
    { month: 'JAN', year: 2026, seniorities: [1, 2] },
  ];
  assert.deepEqual(calculateCategorySeniority(periods, 250), {
    percentile: 50,
    seniorOrEqual: 2,
    totalPilots: 4,
    month: 'FEB',
    year: 2026,
  });
  assert.equal(calculateCategorySeniority(periods, 100)?.percentile, 25);
  assert.equal(calculateCategorySeniority(periods, 50)?.percentile, 0);
  assert.equal(calculateCategorySeniority(periods, 999)?.percentile, 100);
  assert.equal(calculateCategorySeniority([], 100), null);
  assert.equal(
    calculateCategorySeniority(
      [{ month: 'invalid', year: 2027, seniorities: [1] }],
      100
    ),
    null
  );
});

test('category lookup separates fleet, base and seat in PostgreSQL without changing real reports', async () => {
  await db.transaction(async tx => {
    await tx.execute(sql`CREATE TEMP TABLE reasons_report_preferences (
      month text, year integer, base text, aircraft text, pilot_seniority_number integer,
      report_banners jsonb
    ) ON COMMIT DROP`);
    await tx.execute(sql`INSERT INTO reasons_report_preferences VALUES
      ('AUG', 2026, 'NYC', '220-B', 100, null),
      ('AUG', 2026, 'NYC', 'A220-B', 200, null),
      ('AUG', 2026, 'NYC', '220 B', 300, null),
      ('AUG', 2026, 'NYC', '220-B', 300, null),
      ('AUG', 2026, 'NYC', '220-A', 100, null),
      ('AUG', 2026, 'NYC', '220', 999, null),
      ('SEP', 2026, 'ATL', '220-B', 999, null),
      ('SEP', 2026, 'NYC', '330-B', 999, null),
      ('JUL', 2026, 'NYC', '220-B', 999, null)`);
    const input = {
      base: 'NYC',
      aircraft: 'A220',
      position: 'B' as const,
      seniorityNumber: 200,
    };
    assert.deepEqual(await getCategorySeniority(input, tx), {
      percentile: 66.7,
      seniorOrEqual: 2,
      totalPilots: 3,
      month: 'AUG',
      year: 2026,
    });
    await tx.execute(sql`UPDATE reasons_report_preferences
      SET report_banners = '["Standing Category 73/165, Regular 70/129, Reserve 3 above/36"]'::jsonb
      WHERE pilot_seniority_number = 200 AND aircraft = 'A220-B'`);
    assert.deepEqual(await getCategorySeniority(input, tx), {
      percentile: 44.2,
      seniorOrEqual: 73,
      totalPilots: 165,
      month: 'AUG',
      year: 2026,
    });
    assert.equal(
      (await getCategorySeniority({ ...input, position: 'A' }, tx))
        ?.totalPilots,
      1
    );
    assert.equal(
      await getCategorySeniority({ ...input, base: 'SEA' }, tx),
      null
    );
    const savedPilot = {
      seniorityNumber: 200,
      aircraft: 'A220-B',
      seniorityPercentile: 48,
    };
    assert.equal(
      await getAnalysisSeniority(
        savedPilot,
        { base: 'NYC', aircraft: '330-B' },
        tx
      ),
      0
    );
    assert.equal(
      await getAnalysisSeniority(
        savedPilot,
        { base: 'NYC', aircraft: 'A220' },
        tx
      ),
      44.2
    );
    assert.equal(
      savedPilot.seniorityPercentile,
      48,
      'viewing another fleet must not mutate the saved profile'
    );
    assert.equal(
      await getAnalysisSeniority(
        savedPilot,
        { base: 'SEA', aircraft: '330-B' },
        tx
      ),
      50
    );
    assert.deepEqual(analysisCategory('NYC', '330', 'A220-B'), {
      base: 'NYC',
      aircraft: '330',
      position: 'B',
    });
    assert.equal(analysisCategory('NYC', '330-A', 'A220-B').position, 'A');
    const comparisons = await getCategoryComparisons(200, tx);
    const fo220 = comparisons.find(
      row =>
        row.base === 'NYC' && row.aircraft === '220' && row.position === 'B'
    );
    const fo330 = comparisons.find(
      row =>
        row.base === 'NYC' && row.aircraft === '330' && row.position === 'B'
    );
    assert.equal(fo220?.percentile, 66.7);
    assert.equal(fo220?.month, 'AUG');
    assert.equal(fo330?.percentile, 0);
    assert.equal(fo330?.month, 'SEP');
    assert.equal(comparisons.length, 4);
    assert.equal(
      categoryKey('NYC', 'A330', 'B'),
      categoryKey(fo330!.base, fo330!.aircraft, fo330!.position)
    );
    assert.notEqual(
      categoryKey('NYC', 'A220', 'B'),
      categoryKey('NYC', 'A330', 'B')
    );
    assert.equal(categoryKey('nyc', '330-A', 'B'), 'NYC|330|A');
  });
});

test('profile inputs reject malformed numbers and seat, and linked profiles recover their seat', () => {
  const input = {
    seniorityNumber: '200',
    base: ' nyc ',
    aircraft: 'a220',
    position: 'B',
  };
  assert.equal(categorySeniorityInput.parse(input).base, 'NYC');
  for (const seniorityNumber of ['12junk', '-2', '0', '3.2', 'Infinity'])
    assert.equal(
      categorySeniorityInput.safeParse({ ...input, seniorityNumber }).success,
      false
    );
  assert.equal(
    categorySeniorityInput.safeParse({ ...input, position: '' }).success,
    false
  );
  assert.deepEqual(publicUser({ aircraft: 'A220-B', syncPin: 'secret' }), {
    aircraft: 'A220',
    position: 'B',
    hasSyncPin: true,
  });
});

test('profile save derives its percentage server-side and preserves the selected position', async () => {
  const { default: express } = await import('express');
  const { storage } = await import('../storage');
  const { registerRoutes } = await import('../routes');
  const originalSave = storage.createOrUpdateUser;
  const originalExecute = db.execute;
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  let saved: Parameters<typeof storage.createOrUpdateUser>[0] | undefined;
  storage.createOrUpdateUser = async input => {
    saved = input;
    return {
      ...input,
      id: 1,
      syncPin: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any;
  };
  const app = express();
  app.use(express.json());
  await registerRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await db.transaction(async tx => {
      await tx.execute(sql`CREATE TEMP TABLE reasons_report_preferences (
        month text, year integer, base text, aircraft text, pilot_seniority_number integer,
        report_banners jsonb
      ) ON COMMIT DROP`);
      await tx.execute(sql`INSERT INTO reasons_report_preferences VALUES
        ('JUL', 2026, 'NYC', '220-B', 100, null),
        ('JUL', 2026, 'NYC', '220-B', 200, null),
        ('JUL', 2026, 'NYC', '220-B', 300, null)`);
      db.execute = tx.execute.bind(tx) as typeof db.execute;
      const input = {
        seniorityNumber: 200,
        base: 'NYC',
        aircraft: 'A220',
        position: 'B',
        seniorityPercentile: 1,
      };
      const response = await fetch(url + '/api/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      assert.equal(response.status, 200);
      const profile = await response.json();
      assert.equal(profile.seniorityPercentile, 67);
      assert.equal(profile.position, 'B');
      assert.equal(profile.aircraft, 'A220');
      assert.equal(saved?.aircraft, 'A220-B');
      assert.equal(profile.categorySeniority.percentile, 66.7);
      const savedBeforeComparison = saved;
      const comparisonResponse = await fetch(
        url + '/api/category-seniority/comparisons?seniorityNumber=100'
      );
      assert.equal(comparisonResponse.status, 200);
      assert.equal(
        (await comparisonResponse.json()).categories[0].percentile,
        33.3
      );
      assert.equal(
        saved,
        savedBeforeComparison,
        'a comparison must not save a new profile'
      );
      assert.equal(
        (
          await fetch(
            url + '/api/category-seniority/comparisons?seniorityNumber=bad'
          )
        ).status,
        400
      );

      const invalid = await fetch(url + '/api/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, seniorityNumber: '12oops' }),
      });
      assert.equal(invalid.status, 400);
      const missing = await fetch(url + '/api/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, base: 'SEA' }),
      });
      const fallback = await missing.json();
      assert.equal(fallback.categorySeniority, null);
      assert.equal(fallback.seniorityPercentile, 50);
      db.execute = originalExecute;
    });
  } finally {
    db.execute = originalExecute;
    storage.createOrUpdateUser = originalSave;
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
