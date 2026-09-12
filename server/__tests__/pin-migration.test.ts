import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { sql } from 'drizzle-orm';
import { db, cleanup } from '../db';
import { migratePinHashes } from '../lib/pin-migration';
import { verifyPin } from '../lib/access-control';
import { users } from '../../shared/schema';

after(cleanup);

test('PIN migration preserves credentials, hashes plaintext, and is repeatable', async () => {
  await db.transaction(async tx => {
    await tx.execute(
      sql`CREATE TEMP TABLE users (LIKE public.users INCLUDING DEFAULTS) ON COMMIT DROP`
    );
    await tx.execute(
      sql`ALTER TABLE pg_temp.users ALTER COLUMN id DROP DEFAULT`
    );
    await tx.execute(
      sql`ALTER TABLE pg_temp.users ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY`
    );
    await tx.insert(users).values({
      seniorityNumber: 1,
      base: 'TEST',
      aircraft: 'TEST',
      syncPin: '123456',
    });
    await migratePinHashes(tx);
    const [first] = await tx.select().from(users);
    assert.match(first.syncPin!, /^scrypt:/);
    assert.equal(await verifyPin('123456', first.syncPin!), true);
    await migratePinHashes(tx);
    assert.equal((await tx.select().from(users))[0].syncPin, first.syncPin);
  });
});

test('profile IDs cannot bypass ownership and PIN updates use the canonical user', async () => {
  const { default: express } = await import('express');
  const { storage } = await import('../storage');
  const { registerRoutes } = await import('../routes');
  const originalUser = storage.getPrimaryUser;
  const originalSet = storage.setSyncPin;
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  let changed: number | undefined;
  storage.getPrimaryUser = async () => ({ id: 1 }) as any;
  storage.setSyncPin = async (id: number) => {
    changed = id;
    return { id, syncPin: 'secret' } as any;
  };
  const app = express();
  app.use(express.json());
  await registerRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    assert.equal((await fetch(`${base}/api/favorites/2`)).status, 403);
    const rejected = await fetch(`${base}/api/user/pin`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 2, pin: '123456' }),
    });
    assert.equal(rejected.status, 403);
    assert.equal(changed, undefined);
    const accepted = await fetch(`${base}/api/user/pin`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '123456' }),
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), { id: 1, hasSyncPin: true });
    assert.equal(changed, 1);
  } finally {
    storage.getPrimaryUser = originalUser;
    storage.setSyncPin = originalSet;
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
  }
});
