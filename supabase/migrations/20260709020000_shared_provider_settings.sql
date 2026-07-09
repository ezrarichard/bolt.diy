-- Shared Provider Settings — Sprint 38.4.
--
-- Metadata-only mirror of which LLM providers have a shared (server-configured) API key —
-- see app/lib/modules/llm/manager.ts's getSharedKeyStatus() and
-- app/routes/api.shared-key-status.ts, the only writer. This table NEVER stores a secret
-- value: the actual keys live only in Cloudflare Pages/Workers secrets (or process.env in
-- local dev) and are never read into this table, never sent to the client, and never
-- logged. This table exists purely so the team can see provider status (e.g. on a future
-- Workspace/admin view) without querying Cloudflare directly.
--
-- Additive to the canonical schema (20260709010000_buildersdb_canonical_schema.sql) — safe
-- to run against the already-verified BuildersDB project without touching any existing
-- table. Idempotent, like every other migration in this project.

create table if not exists builders_shared_provider_settings (
  provider_key text primary key,
  display_name text not null,
  enabled boolean not null default false,
  default_model text,
  shared_key_configured boolean not null default false,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function builders_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at on builders_shared_provider_settings;
create trigger set_updated_at before update on builders_shared_provider_settings
  for each row execute function builders_set_updated_at();

alter table builders_shared_provider_settings enable row level security;

drop policy if exists "builders_shared_provider_settings_anon_all" on builders_shared_provider_settings;
create policy "builders_shared_provider_settings_anon_all" on builders_shared_provider_settings for all using (true) with check (true);
