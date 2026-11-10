-- Business extension, not Casdoor identity or model tables.
CREATE TABLE ai_configuration (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 base_url text NOT NULL, model text NOT NULL, enabled boolean NOT NULL DEFAULT false,
 max_output_tokens integer NOT NULL DEFAULT 2048 CHECK(max_output_tokens BETWEEN 1 AND 32768),
 encrypted_key text, key_updated_at timestamptz,
 revision integer NOT NULL DEFAULT 1, last_check jsonb,
 updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES identities(uid)
);
CREATE TABLE ai_product_access (
 product_id text PRIMARY KEY REFERENCES products(id),
 enabled boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid NOT NULL REFERENCES identities(uid)
);
CREATE TABLE ai_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id text NOT NULL REFERENCES products(id),
 uid uuid NOT NULL REFERENCES identities(uid), request_id text NOT NULL,
 model text NOT NULL, config_revision integer NOT NULL,
 status text NOT NULL CHECK(status IN ('processing','completed','failed','unknown')),
 stream boolean NOT NULL, http_status integer, error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 UNIQUE(product_id,request_id)
);
CREATE INDEX ai_requests_recent ON ai_requests(created_at DESC);
