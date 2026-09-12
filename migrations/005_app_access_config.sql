-- Also created automatically on first hosted access.
CREATE TABLE IF NOT EXISTS app_access_config (
  id integer PRIMARY KEY CHECK (id = 1),
  pin_hash text NOT NULL
);
