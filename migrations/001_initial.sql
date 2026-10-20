CREATE TABLE IF NOT EXISTS identities (
 uid uuid PRIMARY KEY DEFAULT gen_random_uuid(), issuer text NOT NULL, subject text NOT NULL,
 organization text NOT NULL, username text NOT NULL, display_name text NOT NULL,
 blocked boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(issuer,subject)
);
CREATE TABLE products (
 id text PRIMARY KEY CHECK(id ~ '^[a-z][a-z0-9_-]{1,39}$'), name text NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
 application text NOT NULL UNIQUE, callback_url text NOT NULL, origin text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE features (
 product_id text NOT NULL REFERENCES products(id), id text NOT NULL,
 name text NOT NULL, kind text NOT NULL CHECK(kind IN ('access','quota')),
 member_only boolean NOT NULL DEFAULT false,
 free_quota integer NOT NULL DEFAULT 0 CHECK(free_quota BETWEEN 0 AND 1000000),
 period text NOT NULL DEFAULT 'once' CHECK(period IN ('once','daily','monthly')),
 active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(product_id,id)
);
CREATE TABLE plans (
 product_id text NOT NULL REFERENCES products(id), id text NOT NULL, name text NOT NULL,
 days integer NOT NULL CHECK(days BETWEEN 1 AND 36500),
 quotas jsonb NOT NULL DEFAULT '{}', active boolean NOT NULL DEFAULT true,
 casdoor_plan text UNIQUE, PRIMARY KEY(product_id,id)
);
CREATE TABLE memberships (
 uid uuid NOT NULL REFERENCES identities(uid), product_id text NOT NULL REFERENCES products(id),
 expires_at timestamptz NOT NULL, PRIMARY KEY(uid,product_id)
);
CREATE TABLE quota_buckets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), uid uuid NOT NULL REFERENCES identities(uid),
 product_id text NOT NULL, feature_id text NOT NULL,
 source text NOT NULL, source_key text NOT NULL,
 remaining integer NOT NULL CHECK(remaining >= 0), held integer NOT NULL DEFAULT 0 CHECK(held >= 0),
 expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(product_id,feature_id) REFERENCES features(product_id,id),
 UNIQUE(uid,product_id,feature_id,source,source_key)
);
CREATE TABLE reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), uid uuid NOT NULL REFERENCES identities(uid),
 product_id text NOT NULL, feature_id text NOT NULL, request_id text NOT NULL CHECK(length(request_id) BETWEEN 8 AND 128),
 amount integer NOT NULL CHECK(amount BETWEEN 1 AND 1000000),
 status text NOT NULL CHECK(status IN ('reserved','confirmed','cancelled','refunded','expired')),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(product_id,feature_id) REFERENCES features(product_id,id),
 UNIQUE(product_id,uid,request_id)
);
CREATE TABLE reservation_parts (
 reservation_id uuid NOT NULL REFERENCES reservations(id), bucket_id uuid NOT NULL REFERENCES quota_buckets(id),
 amount integer NOT NULL CHECK(amount>0), PRIMARY KEY(reservation_id,bucket_id)
);
CREATE TABLE redemption_codes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hash text NOT NULL UNIQUE, hint text NOT NULL,
 product_id text NOT NULL REFERENCES products(id), days integer NOT NULL DEFAULT 0 CHECK(days BETWEEN 0 AND 36500),
 feature_id text, amount integer NOT NULL DEFAULT 0 CHECK(amount BETWEEN 0 AND 1000000),
 max_uses integer NOT NULL CHECK(max_uses BETWEEN 1 AND 100000), uses integer NOT NULL DEFAULT 0 CHECK(uses>=0),
 active boolean NOT NULL DEFAULT true, expires_at timestamptz NOT NULL, quota_expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(days>0 OR amount>0), CHECK(uses<=max_uses),
 FOREIGN KEY(product_id,feature_id) REFERENCES features(product_id,id)
);
CREATE TABLE redemptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code_id uuid NOT NULL REFERENCES redemption_codes(id),
 uid uuid NOT NULL REFERENCES identities(uid), product_id text NOT NULL REFERENCES products(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(code_id,uid)
);
CREATE TABLE ledger (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, uid uuid NOT NULL REFERENCES identities(uid),
 product_id text NOT NULL REFERENCES products(id), feature_id text,
 action text NOT NULL, amount integer, reference text NOT NULL,
 detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_user ON ledger(uid,id DESC);
CREATE TABLE audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_uid uuid NOT NULL REFERENCES identities(uid),
 action text NOT NULL, target text NOT NULL, reason text NOT NULL,
 before_value jsonb, after_value jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY, app_id text NOT NULL, uid uuid NOT NULL REFERENCES identities(uid),
 access_token text NOT NULL, id_token text NOT NULL, csrf text NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions(uid);
CREATE TABLE login_attempts (
 token_hash text PRIMARY KEY, app_id text NOT NULL, state text NOT NULL, nonce text NOT NULL,
 verifier text NOT NULL, mode text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE subscription_projections (
 source_id text PRIMARY KEY, uid uuid NOT NULL REFERENCES identities(uid), product_id text NOT NULL REFERENCES products(id),
 plan_id text NOT NULL, expires_at timestamptz NOT NULL, active boolean NOT NULL,
 snapshot jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE reconcile_runs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_uid uuid REFERENCES identities(uid),
 result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE demo_jobs (
 app_id text NOT NULL, uid uuid NOT NULL REFERENCES identities(uid), request_id text NOT NULL,
 mode text NOT NULL, result jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(app_id,uid,request_id)
);
CREATE FUNCTION no_mutation() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'append-only table'; END$$;
CREATE TRIGGER ledger_append_only BEFORE UPDATE OR DELETE ON ledger FOR EACH ROW EXECUTE FUNCTION no_mutation();
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit FOR EACH ROW EXECUTE FUNCTION no_mutation();
