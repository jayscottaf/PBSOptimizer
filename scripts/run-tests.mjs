#!/usr/bin/env node
/**
 * Runs every node:test file (*.test.ts / *.test.tsx under server, client and
 * shared) plus the standalone check scripts.
 *
 *   npm test          no database: DB-backed tests are reported as skipped
 *   npm run test:db   also runs DB-backed tests against DATABASE_URL (.env);
 *                     point it at a development database, not production
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const withDatabase = process.argv.includes('--db');
const ROOTS = ['server', 'client', 'shared'];
const CHECK_SCRIPTS = [
  'scripts/bid-tools-check.ts',
  'scripts/pairing-comparison-check.ts',
  'scripts/commute-fit-check.ts',
];

function findTests(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return findTests(path);
    return /\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const env = { ...process.env };
if (withDatabase) {
  env.PBS_TEST_DATABASE = '1';
} else {
  // Modules that import server/db.ts refuse to load without a URL. Set an
  // address that cannot connect: dotenv never overrides an existing
  // variable, so a real DATABASE_URL in .env cannot be reached by a unit
  // test by accident, and any unmarked test that queries fails loudly.
  env.DATABASE_URL = 'postgresql://unit-test:unit-test@127.0.0.1:1/none';
  delete env.PBS_TEST_DATABASE;
}

const files = ROOTS.flatMap(findTests).sort();
console.log(
  `Running ${files.length} test files${withDatabase ? ' (with database)' : ''}`
);
const run = (args, label) => {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env });
  if (result.status !== 0) {
    console.error(`\n${label} failed`);
    process.exit(result.status ?? 1);
  }
};

run(['--import', 'tsx', '--test', ...files], 'node:test suite');
for (const script of CHECK_SCRIPTS) {
  console.log(`\n${script}`);
  run(['--import', 'tsx', script], script);
}
console.log('\nAll tests passed.');
