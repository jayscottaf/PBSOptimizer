import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Pool } from '@neondatabase/serverless';
import {
  db,
  cleanup,
  executeWithRetry,
  reconnectDatabase,
  getDatabaseHealth,
} from '../db';
import { storage } from '../storage';

after(cleanup);

test('concurrent recovery publishes one client and retries an actual storage read', async () => {
  const original = db.$client;
  const query = Pool.prototype.query;
  const end = Pool.prototype.end;
  const ended = new Set<Pool>();
  let replacements = 0;
  let failOriginal = true;
  try {
    Pool.prototype.end = async function (this: Pool) {
      ended.add(this);
    } as any;
    Pool.prototype.query = async function (this: Pool, statement: any) {
      if (ended.has(this)) throw new Error('Pool is ending');
      if (this === original && failOriginal) {
        failOriginal = false;
        throw new Error('Connection terminated');
      }
      if (typeof statement === 'string') {
        if (statement.includes('as test')) replacements++;
        return { rows: [{ test: 1 }] };
      }
      // Drizzle SELECT of users uses array-mode rows and maps them to User.
      return {
        rows: [
          [
            7,
            'Synthetic pilot',
            100,
            50,
            'TEST',
            'A220',
            null,
            '2026-08-01',
            '2026-08-01',
          ],
        ],
      };
    } as any;
    const user = await executeWithRetry(() => storage.getPrimaryUser());
    assert.equal(user?.id, 7);
    assert.notEqual(db.$client, original);
    assert.ok(ended.has(original));
    assert.equal(replacements, 1);
    const current = db.$client;
    const first = reconnectDatabase();
    const second = reconnectDatabase();
    assert.equal(first, second, 'concurrent recoveries share one promise');
    await Promise.all([first, second]);
    assert.equal(replacements, 2);
    assert.ok(ended.has(current));
    assert.equal(db.$client.listenerCount('error'), 1);
    assert.equal((await getDatabaseHealth()).connected, true);
    assert.equal((await storage.getPrimaryUser())?.id, 7);
  } finally {
    Pool.prototype.query = query;
    Pool.prototype.end = end;
  }
});

test('a failed replacement is closed before retry and never published', async () => {
  const current = db.$client;
  const query = Pool.prototype.query;
  const end = Pool.prototype.end;
  const ended = new Set<Pool>();
  let failed: Pool | undefined;
  try {
    Pool.prototype.end = async function (this: Pool) {
      ended.add(this);
    } as any;
    Pool.prototype.query = async function (this: Pool) {
      if (!failed) {
        failed = this;
        assert.equal(db.$client, current);
        throw new Error('ECONNREFUSED');
      }
      assert.ok(ended.has(failed));
      assert.equal(db.$client, current);
      return { rows: [{ test: 1 }] };
    } as any;
    await reconnectDatabase();
    assert.notEqual(db.$client, failed);
    assert.notEqual(db.$client, current);
    assert.ok(ended.has(current));
  } finally {
    Pool.prototype.query = query;
    Pool.prototype.end = end;
  }
});
