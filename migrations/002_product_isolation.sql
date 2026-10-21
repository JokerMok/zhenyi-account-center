ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_jobs ENABLE ROW LEVEL SECURITY;
-- Example database roles are local-only. A production center can use protocol/API-only products.
DO $$ BEGIN
IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='beadgrid_backend') AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname='focustake_backend') THEN
CREATE POLICY product_sessions ON sessions TO beadgrid_backend,focustake_backend
 USING(app_id=replace(current_user,'_backend','')) WITH CHECK(app_id=replace(current_user,'_backend',''));
CREATE POLICY product_logins ON login_attempts TO beadgrid_backend,focustake_backend
 USING(app_id=replace(current_user,'_backend','')) WITH CHECK(app_id=replace(current_user,'_backend',''));
CREATE POLICY product_jobs ON demo_jobs TO beadgrid_backend,focustake_backend
 USING(app_id=replace(current_user,'_backend','')) WITH CHECK(app_id=replace(current_user,'_backend',''));
GRANT USAGE ON SCHEMA public TO beadgrid_backend,focustake_backend;
GRANT SELECT,INSERT,UPDATE,DELETE ON sessions,login_attempts,demo_jobs TO beadgrid_backend,focustake_backend;

END IF;
END $$;
