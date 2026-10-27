#!/bin/bash
# First boot only (run by the official Postgres entrypoint): the roles and schemas that Supabase Auth, Storage and PostgREST expect.
set -euo pipefail
psql -v ON_ERROR_STOP=1 -U postgres -d postgres -v pw="$POSTGRES_PASSWORD" <<'SQL'
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit password :'pw';
grant anon, authenticated, service_role to authenticator;

create role supabase_auth_admin login createrole noinherit password :'pw';
create schema auth authorization supabase_auth_admin;
alter role supabase_auth_admin set search_path = auth;
grant usage on schema auth to anon, authenticated, service_role;
alter default privileges for role supabase_auth_admin in schema auth grant execute on functions to anon, authenticated, service_role;

create role supabase_storage_admin login createrole noinherit password :'pw';
create schema storage authorization supabase_storage_admin;
alter role supabase_storage_admin set search_path = storage;
grant anon, authenticated, service_role to supabase_storage_admin;
grant usage on schema storage to anon, authenticated, service_role;
alter default privileges for role supabase_storage_admin in schema storage grant all on tables to anon, authenticated, service_role;
alter default privileges for role supabase_storage_admin in schema storage grant all on functions to anon, authenticated, service_role;
alter default privileges for role supabase_storage_admin in schema storage grant all on sequences to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;

create extension if not exists pgcrypto;
SQL
