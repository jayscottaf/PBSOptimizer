/**
 * Test option for tests that run real SQL (temp tables, transactions,
 * PostgreSQL-specific expressions). `npm test` never connects to a database,
 * so these are reported as skipped with this reason rather than failing on a
 * missing connection. `npm run test:db` runs them against DATABASE_URL.
 */
export const requiresDatabase = {
  skip:
    process.env.PBS_TEST_DATABASE === '1'
      ? false
      : 'needs a real PostgreSQL database; run `npm run test:db`',
} as const;
