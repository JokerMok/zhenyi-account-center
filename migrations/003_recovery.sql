CREATE TABLE task_recovery_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 product_id text NOT NULL REFERENCES products(id),
 reservation_id uuid NOT NULL REFERENCES reservations(id),
 uid uuid NOT NULL REFERENCES identities(uid),
 action text NOT NULL CHECK(action IN ('cancel','refund')),
 reason text NOT NULL,
 before_status text NOT NULL,
 after_status text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER recovery_append_only BEFORE UPDATE OR DELETE ON task_recovery_audit FOR EACH ROW EXECUTE FUNCTION no_mutation();
ALTER TABLE demo_jobs ADD COLUMN stage text NOT NULL DEFAULT 'complete';
ALTER TABLE demo_jobs ADD COLUMN reservation_id uuid;
ALTER TABLE demo_jobs ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
