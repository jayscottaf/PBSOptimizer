import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS user_bid_profiles (
      id serial PRIMARY KEY,
      user_id integer NOT NULL UNIQUE REFERENCES users(id),
      employee_number text,
      weights jsonb NOT NULL,
      source text NOT NULL DEFAULT 'manual',
      learned_from_periods integer DEFAULT 0,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS user_bid_profiles_user_id_idx ON user_bid_profiles(user_id)`
  );
  const check = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'user_bid_profiles' ORDER BY ordinal_position
  `);
  console.log('user_bid_profiles columns:', check.rows.map((r: any) => r.column_name));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
