import { sql } from 'drizzle-orm';
import { db } from '../db';

// Deployment-wide budget: persists across restarts and serverless instances.
export function createAccessSessions(
  database: Pick<typeof db, 'execute'> = db
) {
  return {
    async attempt() {
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
      await database.execute(
        sql`DELETE FROM app_access_sessions WHERE expires_at < now()`
      );
      await database.execute(sql`INSERT INTO app_access_sessions (token, credential, expires_at)
      VALUES (${token}, ${credential}, now() + interval '7 days')`);
    },
    async valid(token: string, credential: string) {
      const result =
        await database.execute(sql`SELECT 1 FROM app_access_sessions
      WHERE token = ${token} AND credential = ${credential} AND expires_at > now()`);
      return result.rows.length > 0;
    },
  };
}
export const accessSessions = createAccessSessions();
