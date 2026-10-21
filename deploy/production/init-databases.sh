#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres \
 --set=casdoor_password="$CASDOOR_DB_PASSWORD" --set=entitlements_password="$ENTITLEMENTS_DB_PASSWORD" <<'SQL'
CREATE ROLE casdoor LOGIN PASSWORD :'casdoor_password';
CREATE ROLE entitlements LOGIN PASSWORD :'entitlements_password';
CREATE DATABASE casdoor OWNER casdoor;
CREATE DATABASE entitlements OWNER entitlements;
REVOKE CONNECT ON DATABASE casdoor FROM PUBLIC;
REVOKE CONNECT ON DATABASE entitlements FROM PUBLIC;
GRANT CONNECT ON DATABASE casdoor TO casdoor;
GRANT CONNECT ON DATABASE entitlements TO entitlements;
SQL
