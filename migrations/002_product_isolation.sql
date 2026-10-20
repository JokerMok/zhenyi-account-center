ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_sessions ON sessions TO beadgrid_backend,focustake_backend
 USING(app_id=replace(current_user,'_backend','')) WITH CHECK(app_id=replace(current_user,'_backend',''));
CREATE POLICY product_logins ON login_attempts TO beadgrid_backend,focustake_backend
 USING(app_id=replace(current_user,'_backend','')) WITH CHECK(app_id=replace(current_user,'_backend',''));
CREATE POLICY product_jobs ON demo_jobs TO beadgrid_backend,focustake_backend
 USING(app_id=replace(current_user,'_backend','')) WITH CHECK(app_id=replace(current_user,'_backend',''));
GRANT USAGE ON SCHEMA public TO beadgrid_backend,focustake_backend;
GRANT SELECT,INSERT,UPDATE,DELETE ON sessions,login_attempts,demo_jobs TO beadgrid_backend,focustake_backend;
