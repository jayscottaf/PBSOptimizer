CREATE TABLE IF NOT EXISTS app_access_attempts (
  id integer PRIMARY KEY CHECK (id = 1),
  attempts bigint NOT NULL,
  window_start timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS app_access_sessions (
  token text PRIMARY KEY,
  credential text NOT NULL,
  expires_at timestamptz NOT NULL
);
