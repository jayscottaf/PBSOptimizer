import { sql } from 'drizzle-orm';
import { db } from '../db';

// Deployment-wide budget: persists across restarts and serverless instances.
export function createAccessSessions(
  database: Pick<typeof db, 'execute' | 'transaction'> = db
) {
  let ready: Promise<void> | undefined;
  function initialize() {
    ready ??= database
      .transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(72819403)`);
        await tx.execute(
          sql`CREATE TABLE IF NOT EXISTS app_access_config (id integer PRIMARY KEY CHECK (id = 1), pin_hash text NOT NULL)`
        );
        await tx.execute(
          sql`CREATE TABLE IF NOT EXISTS app_access_attempts (id integer PRIMARY KEY CHECK (id = 1), attempts bigint NOT NULL, window_start timestamptz NOT NULL)`
        );
        await tx.execute(
          sql`CREATE TABLE IF NOT EXISTS app_access_sessions (token text PRIMARY KEY, credential text NOT NULL, expires_at timestamptz NOT NULL)`
        );
      })
      .catch(error => {
        ready = undefined;
        throw error;
      });
    return ready;
  }
  return {
    async getPin() {
      await initialize();
      const result = await database.execute(
        sql`SELECT pin_hash FROM app_access_config WHERE id = 1`
      );
      return result.rows[0]?.pin_hash as string | undefined;
    },
    async createPin(hash: string) {
      await initialize();
      const result = await database.execute(
        sql`INSERT INTO app_access_config (id, pin_hash) VALUES (1, ${hash}) ON CONFLICT (id) DO NOTHING RETURNING id`
      );
      return result.rows.length === 1;
    },
    async attempt() {
      await initialize();
      const result = await database.execute(sql`
      INSERT INTO app_access_attempts (id, attempts, window_start)
      VALUES (1, 1, now())
      ON CONFLICT (id) DO UPDATE SET
        attempts = CASE WHEN app_access_attempts.window_start < now() - interval '15 minutes'
          THEN 1 ELSE app_access_attempts.attempts + 1 END,
        window_start = CASE WHEN app_access_attempts.window_start < now() - interval '15 minutes'
          THEN now() ELSE app_access_attempts.window_start END
      RETURNING attempts
    `);
      return Number(result.rows[0].attempts) <= 5;
    },
    async save(token: string, credential: string) {
      await initialize();
      await database.execute(
        sql`DELETE FROM app_access_sessions WHERE expires_at < now()`
      );
      await database.execute(sql`INSERT INTO app_access_sessions (token, credential, expires_at)
      VALUES (${token}, ${credential}, now() + interval '7 days')`);
    },
    async valid(token: string, credential: string) {
      await initialize();
      const result =
        await database.execute(sql`SELECT 1 FROM app_access_sessions
      WHERE token = ${token} AND credential = ${credential} AND expires_at > now()`);
      return result.rows.length > 0;
    },
  };
}
export const accessSessions = createAccessSessions();
