-- Add ALV (Average Line Value) fields to bid_packages table

ALTER TABLE bid_packages ADD COLUMN IF NOT EXISTS alv_hours DECIMAL(5,2);
ALTER TABLE bid_packages ADD COLUMN IF NOT EXISTS alv_table JSONB;

-- Add index for alv_hours for faster queries
CREATE INDEX IF NOT EXISTS idx_bid_packages_alv_hours ON bid_packages(alv_hours);
