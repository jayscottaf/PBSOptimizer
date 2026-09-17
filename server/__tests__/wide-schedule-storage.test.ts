import assert from 'node:assert/strict';
import test from 'node:test';
import { createWideScheduleStorageInitializer } from '../lib/wide-schedule-storage';

test('initializes wide schedule storage once for concurrent callers', async () => {
  const statements: unknown[] = [];
  let transactions = 0;
  const database = {
    execute: async () => ({ rows: [] }),
    transaction: async (
      callback: (tx: {
        execute: (query: unknown) => Promise<void>;
      }) => Promise<void>
    ) => {
      transactions += 1;
      await callback({
        execute: async query => {
          statements.push(query);
        },
      });
    },
  };
  const initialize = createWideScheduleStorageInitializer(
    database as Parameters<typeof createWideScheduleStorageInitializer>[0]
  );

  await Promise.all([initialize(), initialize(), initialize()]);

  assert.equal(transactions, 1);
  assert.equal(statements.length, 3);
});

test('allows initialization to retry after a database failure', async () => {
  let transactions = 0;
  const database = {
    execute: async () => ({ rows: [] }),
    transaction: async (
      callback: (tx: { execute: () => Promise<void> }) => Promise<void>
    ) => {
      transactions += 1;
      if (transactions === 1) throw new Error('temporary database failure');
      await callback({ execute: async () => undefined });
    },
  };
  const initialize = createWideScheduleStorageInitializer(
    database as Parameters<typeof createWideScheduleStorageInitializer>[0]
  );

  await assert.rejects(initialize(), /temporary database failure/);
  await initialize();

  assert.equal(transactions, 2);
});
