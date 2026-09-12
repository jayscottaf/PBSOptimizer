import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import { db, cleanup } from '../server/db';
try {
  await db.execute(
    sql.raw(
      await readFile(
        new URL('../migrations/004_app_access_sessions.sql', import.meta.url),
        'utf8'
      )
    )
  );
  console.log('App access tables ready.');
} finally {
  await cleanup();
}
