-- Calendar entries that are not bid-package trips: training, reserve,
-- vacation and manual events. Run BEFORE deploying the code that uses them.
ALTER TABLE user_calendar_events
  ALTER COLUMN pairing_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'pairing',
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS credit_hours numeric(5, 2);
