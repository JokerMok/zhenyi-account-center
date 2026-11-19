-- Exempt tasks retain the normal lifecycle without touching quota buckets.
ALTER TABLE reservations ADD COLUMN quota_exempt boolean NOT NULL DEFAULT false;
