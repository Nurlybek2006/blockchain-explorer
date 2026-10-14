#!/bin/sh
set -eu
# psql reads passwords from environment, never command arguments or log output.
psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<'SQL'
\getenv identity_password IDENTITY_DB_PASSWORD
\getenv explorer_password EXPLORER_DB_PASSWORD
\getenv portfolio_password PORTFOLIO_DB_PASSWORD
CREATE ROLE identity LOGIN PASSWORD :'identity_password';
CREATE ROLE explorer LOGIN PASSWORD :'explorer_password';
CREATE ROLE portfolio LOGIN PASSWORD :'portfolio_password';
CREATE DATABASE identity_db OWNER identity;
CREATE DATABASE explorer_db OWNER explorer;
CREATE DATABASE portfolio_db OWNER portfolio;
REVOKE CONNECT ON DATABASE identity_db FROM PUBLIC;
REVOKE CONNECT ON DATABASE explorer_db FROM PUBLIC;
REVOKE CONNECT ON DATABASE portfolio_db FROM PUBLIC;
GRANT CONNECT ON DATABASE identity_db TO identity;
GRANT CONNECT ON DATABASE explorer_db TO explorer;
GRANT CONNECT ON DATABASE portfolio_db TO portfolio;
SQL
