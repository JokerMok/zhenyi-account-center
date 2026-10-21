ALTER TABLE identities ADD COLUMN is_test boolean NOT NULL DEFAULT false;
ALTER TABLE identities ADD COLUMN test_note text;
-- A prefix is only a hint. Existing data is not silently reclassified.
ALTER TABLE products ADD COLUMN verified_environment text;
ALTER TABLE products ADD COLUMN verified_at timestamptz;
ALTER TABLE products ADD COLUMN verification_note text;
CREATE TABLE integration_checks (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 product_id text NOT NULL REFERENCES products(id), actor_uid uuid NOT NULL REFERENCES identities(uid),
 result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sync_attempts (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_uid uuid REFERENCES identities(uid),
 status text NOT NULL CHECK(status IN ('processing','success','partial','failed')),
 result jsonb, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
CREATE UNIQUE INDEX sync_one_processing ON sync_attempts((status)) WHERE status='processing';
CREATE TABLE capability_checks (
 id text PRIMARY KEY, status text NOT NULL, detail text NOT NULL, checked_at timestamptz NOT NULL DEFAULT now()
);
