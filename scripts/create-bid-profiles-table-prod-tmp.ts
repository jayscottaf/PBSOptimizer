import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.PROD_DATABASE_URL!);

async function main() {
  await sql`
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
  `;
  await sql`CREATE INDEX IF NOT EXISTS user_bid_profiles_user_id_idx ON user_bid_profiles(user_id)`;
  const check = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'user_bid_profiles' ORDER BY ordinal_position
  `;
  console.log('PROD user_bid_profiles columns:', check.map((r: any) => r.column_name));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
