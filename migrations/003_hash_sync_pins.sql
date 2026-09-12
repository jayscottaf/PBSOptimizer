-- Apply with scripts/migrate-pin-hashes.ts to widen and hash in one transaction.
ALTER TABLE users ALTER COLUMN sync_pin TYPE text;
