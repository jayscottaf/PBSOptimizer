CREATE TABLE IF NOT EXISTS "wide_schedule_lines" (
  "id" serial PRIMARY KEY NOT NULL,
  "month" text NOT NULL,
  "year" integer NOT NULL,
  "base" text NOT NULL,
  "aircraft" text NOT NULL,
  "position" text NOT NULL,
  "pilot_seniority" integer,
  "source_label" text,
  "total_credit_hours" numeric(5, 2) NOT NULL,
  "days_off" integer,
  "line_type" text NOT NULL,
  "flags" jsonb NOT NULL,
  "events" jsonb NOT NULL,
  "uploaded_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "wide_schedule_category_period_idx"
  ON "wide_schedule_lines" USING btree
  ("base", "aircraft", "position", "year", "month");
