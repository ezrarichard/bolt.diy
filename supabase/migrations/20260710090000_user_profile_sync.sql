-- Sprint 41.6 — User Profile Sync.
--
-- Additive migration on top of 20260710080000_auth_foundation.sql, which already created
-- `public.profiles`, its RLS (select/update own), and a bare-bones `on_auth_user_created`
-- trigger. This migration:
--   1. Keeps the existing table shape — no drop/recreate, no column changes.
--   2. Replaces the trigger function so a new auth user's profile is seeded with a real
--      display name (from signup metadata) and avatar_url when available, not just email.
--   3. Backfills a profile row for any existing auth user that doesn't have one yet — safe,
--      `on conflict (id) do nothing`, so it can never overwrite a profile a user already has.
--   4. Re-affirms the self-select/self-update RLS policies (auth.uid() = id) and adds a
--      self-INSERT policy — needed for the "recover a missing profile row on next login"
--      client-side upsert (app/lib/auth/profileClient.ts's ensureUserProfile()), which runs
--      as the authenticated user, not as the SECURITY DEFINER trigger.
--   5. Adds the same `updated_at` trigger convention every other BuildersDB table already
--      uses (builders_set_updated_at(), first defined in the canonical schema migration) —
--      the Sprint 40 migration created the table but never wired this up.

-- ============================================================================
-- Trigger function: seed display_name/avatar_url from signup metadata when available.
-- ============================================================================

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  seeded_display_name text;
  seeded_avatar_url text;
begin
  seeded_display_name := coalesce(
    new.raw_user_meta_data ->> 'display_name',
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    new.email
  );
  seeded_avatar_url := new.raw_user_meta_data ->> 'avatar_url';

  insert into public.profiles (id, email, display_name, avatar_url)
  values (new.id, new.email, seeded_display_name, seeded_avatar_url)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ============================================================================
-- Backfill: any auth user created before this trigger existed (or before Sprint 40's
-- trigger existed at all) gets a profile row now. Never touches a row that already exists.
-- ============================================================================

insert into public.profiles (id, email, display_name, avatar_url)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data ->> 'display_name', u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', u.email),
  u.raw_user_meta_data ->> 'avatar_url'
from auth.users u
on conflict (id) do nothing;

-- ============================================================================
-- RLS — re-affirm self-select/self-update, add self-insert (for the client-side recovery
-- upsert), all scoped to auth.uid() = id. No permissive `using (true)` anywhere.
-- ============================================================================

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select to authenticated using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check (auth.uid() = id);

-- ============================================================================
-- updated_at — same shared trigger function every other BuildersDB table uses.
-- ============================================================================

drop trigger if exists set_updated_at on public.profiles;
create trigger set_updated_at before update on public.profiles
  for each row execute function builders_set_updated_at();
