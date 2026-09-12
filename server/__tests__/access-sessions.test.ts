import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { sql } from 'drizzle-orm';
import { db, cleanup } from '../db';
import { createAccessSessions } from '../lib/access-sessions';

after(cleanup);
test('database shares attempt budgets and expires sessions', async () => {
  await db.transaction(async tx => {
    await tx.execute(sql`SET LOCAL search_path TO pg_temp, public`);
    await tx.execute(
      sql`CREATE TEMP TABLE app_access_config (id integer PRIMARY KEY, pin_hash text NOT NULL) ON COMMIT DROP`
    );
    await tx.execute(
      sql`CREATE TEMP TABLE app_access_attempts (id integer PRIMARY KEY, attempts bigint, window_start timestamptz) ON COMMIT DROP`
    );
    await tx.execute(
      sql`CREATE TEMP TABLE app_access_sessions (token text PRIMARY KEY, credential text, expires_at timestamptz) ON COMMIT DROP`
    );
    const first = createAccessSessions(tx);
    const second = createAccessSessions(tx);
    assert.equal(await first.getPin(), undefined);
    assert.equal(await first.createPin('salted-test-hash'), true);
    assert.equal(await second.createPin('other-hash'), false);
    assert.equal(await second.getPin(), 'salted-test-hash');
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => (i % 2 ? first : second).attempt())
    );
    assert.equal(results.filter(Boolean).length, 5);
    await tx.execute(
      sql`UPDATE app_access_attempts SET window_start = now() - interval '16 minutes'`
    );
    assert.equal(await second.attempt(), true);
    await first.save('token-hash', 'credential-hash');
    assert.equal(await second.valid('token-hash', 'credential-hash'), true);
    assert.equal(await second.valid('token-hash', 'wrong'), false);
    await tx.execute(
      sql`UPDATE app_access_sessions SET expires_at = now() - interval '1 second'`
    );
    assert.equal(await second.valid('token-hash', 'credential-hash'), false);
    await first.save('new-token', 'credential-hash');
    const count = await tx.execute(
      sql`SELECT count(*) FROM app_access_sessions`
    );
    assert.equal(Number(count.rows[0].count), 1);
  });
});
