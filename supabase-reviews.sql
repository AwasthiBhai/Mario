-- STARLIT PIP — Reviews: Supabase upgrade path (optional, recommended long-term).
-- ---------------------------------------------------------------------------
-- The game reads/writes global reviews through Supabase automatically as soon
-- as a Project URL + anon key are set in `js/reviews-config.js`.
--
-- 1. Create a free project at https://supabase.com
-- 2. Open the project → SQL Editor → run this whole file.
-- 3. Project Settings → API → copy the Project URL + `anon` `public` key
--    into `js/reviews-config.js` (SUPABASE_URL / SUPABASE_ANON_KEY).
-- 4. Commit + push. GitHub Pages redeploys; Reviews now use Postgres with
--    server timestamps. No other code changes needed.
--
-- SECURITY: the `anon` key this pairs with is explicitly designed to be
-- embedded in public frontend code. Row Level Security below allows anonymous
-- visitors to READ all reviews and INSERT new ones (with sane checks), but
-- NOT to UPDATE or DELETE anything — so nobody can edit or wipe other
-- players' reviews, and no admin operation is reachable from a browser.
-- Only ever use the `anon` key in frontend code. NEVER the service_role key.

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  rating int not null check (rating between 1 and 5),
  text text not null check (char_length(text) between 1 and 600),
  created_at timestamptz not null default now()
);

alter table public.reviews enable row level security;

drop policy if exists "reviews_public_read" on public.reviews;
create policy "reviews_public_read"
  on public.reviews for select
  using (true);

drop policy if exists "reviews_public_insert" on public.reviews;
create policy "reviews_public_insert"
  on public.reviews for insert
  with check (
    char_length(name) between 1 and 40
    and rating between 1 and 5
    and char_length(text) between 1 and 600
  );

-- No UPDATE / DELETE policies: anonymous clients cannot modify or remove rows.

create index if not exists reviews_created_at_idx
  on public.reviews (created_at desc);
