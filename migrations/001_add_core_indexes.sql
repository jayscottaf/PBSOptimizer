-- Core indexes to speed common filters and sorts
-- Safe to run multiple times using IF NOT EXISTS semantics

CREATE INDEX IF NOT EXISTS idx_pairings_pkg_pairingnumber
  ON pairings (bid_package_id, pairing_number);

CREATE INDEX IF NOT EXISTS idx_pairings_pkg_holdprob
  ON pairings (bid_package_id, hold_probability);

CREATE INDEX IF NOT EXISTS idx_pairings_pkg_days
  ON pairings (bid_package_id, pairing_days);

-- credit_hours and block_hours are numeric in schema; btree is fine for sort/range
CREATE INDEX IF NOT EXISTS idx_pairings_pkg_credit
  ON pairings (bid_package_id, credit_hours);

CREATE INDEX IF NOT EXISTS idx_pairings_pkg_block
  ON pairings (bid_package_id, block_hours);


