import { sql } from 'drizzle-orm';
import { db } from '../db';

export function createWideScheduleStorageInitializer(
  database: Pick<typeof db, 'execute' | 'transaction'> = db
) {
  let ready: Promise<void> | undefined;

  return function ensureWideScheduleStorage() {
    ready ??= database
      .transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(72819404)`);
        await tx.execute(sql`
          CREATE TABLE IF NOT EXISTS wide_schedule_lines (
            id serial PRIMARY KEY,
            month text NOT NULL,
            year integer NOT NULL,
            base text NOT NULL,
            aircraft text NOT NULL,
            position text NOT NULL,
            pilot_seniority integer,
            source_label text,
            total_credit_hours numeric(5, 2) NOT NULL,
            days_off integer,
            line_type text NOT NULL,
            flags jsonb NOT NULL,
            events jsonb NOT NULL,
            uploaded_at timestamp DEFAULT now() NOT NULL
          )
        `);
        await tx.execute(sql`
          CREATE INDEX IF NOT EXISTS wide_schedule_category_period_idx
          ON wide_schedule_lines (base, aircraft, position, year, month)
        `);
      })
      .catch(error => {
        ready = undefined;
        throw error;
      });
    return ready;
  };
}

export const ensureWideScheduleStorage = createWideScheduleStorageInitializer();
