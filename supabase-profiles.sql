-- STARBOUND — Profiles + Leaderboard: Supabase upgrade path (optional future).
-- ---------------------------------------------------------------------------
-- The game reads/writes global profiles through the secure backend API
-- (server/ → same database service as Reviews, entry `profiles-v1`), which
-- verifies edit-secret ownership server-side. This file is the DOCUMENTED
-- strict upgrade path to normalized Postgres when the project outgrows a
-- single shared document.
--
-- 1. Create a free project at https://supabase.com
-- 2. Open the project → SQL Editor → run this whole file.
-- 3. Wire a tiny server-side writer (Edge Function / service) that enforces
--    edit-secret ownership on UPDATE — a static Pages site cannot do this
--    alone, which is why the game uses the shared document by default.
--
-- SECURITY DESIGN:
--   - `profiles_public` is the ONLY readable surface for anonymous clients.
--     It structurally excludes `private_id` and `secret_hash`: private IDs
--     stay visible to the owner only, and edit secrets never leave the device
--     (only their SHA-256 hash is stored).
--   - Anonymous clients may SELECT the public view and INSERT new rows (with
--     sane checks). There are deliberately NO anonymous UPDATE/DELETE
--     policies — stat merges and profile edits must go through the
--     ownership-checking writer from step 3. Never commit a service_role key
--     to frontend code.
--
-- RANKING (deterministic, mirrors the shared-doc client in js/profiles.js):
--   total best score DESC → levels completed DESC → lifetime coins DESC →
--   first achievement (created_at ASC) → public_id ASC.

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique check (public_id ~ '^p_[a-z0-9_]{1,60}$'),
  private_id text not null unique check (char_length(private_id) between 3 and 20),
  display_name text not null check (char_length(display_name) between 1 and 24),
  avatar_kind text not null default 'preset' check (avatar_kind in ('preset', 'custom')),
  avatar_ref text not null default 'nova-star' check (char_length(avatar_ref) <= 9200),
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  total_coins bigint not null default 0 check (total_coins >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  seen_at timestamptz not null default now()
);

create table if not exists public.level_stats (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  level int not null check (level between 1 and 50),
  best_score int not null default 0 check (best_score between 0 and 100000),
  best_coins int not null default 0 check (best_coins between 0 and 500),
  attempts int not null default 0 check (attempts >= 0),
  best_time_ms int not null default 0 check (best_time_ms between 0 and 3600000),
  updated_at timestamptz not null default now(),
  primary key (profile_id, level)
);

-- Public surface: no private_id, no secret_hash, ever.
create or replace view public.profiles_public as
  select
    p.public_id,
    p.display_name,
    p.avatar_kind,
    p.avatar_ref,
    p.total_coins,
    p.created_at,
    p.updated_at,
    coalesce(sum(s.best_score), 0)::bigint as total_score,
    count(s.level)::int as levels_completed
  from public.profiles p
  left join public.level_stats s on s.profile_id = p.id
  group by p.id;

alter table public.profiles enable row level security;
alter table public.level_stats enable row level security;

-- Anonymous read: public view only (base tables grant nothing to anon).
drop policy if exists "profiles_public_read" on public.profiles;
create policy "profiles_public_read"
  on public.profiles for select
  using (false); -- reads go through profiles_public via a privileged writer

drop policy if exists "profiles_public_insert" on public.profiles;
create policy "profiles_public_insert"
  on public.profiles for insert
  with check (
    char_length(display_name) between 1 and 24
    and char_length(private_id) between 3 and 20
    and char_length(avatar_ref) <= 9200
    and total_coins = 0
  );

drop policy if exists "level_stats_public_insert" on public.level_stats;
create policy "level_stats_public_insert"
  on public.level_stats for insert
  with check (
    level between 1 and 50
    and best_score between 0 and 100000
    and best_coins between 0 and 500
    and attempts >= 0
    and best_time_ms between 0 and 3600000
  );

-- No UPDATE / DELETE policies: anonymous clients cannot modify or remove rows.

create index if not exists profiles_created_at_idx
  on public.profiles (created_at asc);
create index if not exists level_stats_profile_idx
  on public.level_stats (profile_id);
