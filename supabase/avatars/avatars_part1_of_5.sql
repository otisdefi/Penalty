-- Tiebreaker profile pictures: PART 1 OF 5. Run the parts in order 1, 2, 3, 4, 5. Safe to run again.
-- Paste this whole part, from this line to the line that says END OF PART 1 OF 5.
--
-- Run these AFTER supabase/schema.sql and supabase/profiles_challenges.sql (or its 5 parts).
-- Part 1: profile columns, small helper tables, and the private "avatars" storage bucket.
--
-- Rules in one place
--   * the bucket is private; object name = the player's user id (one file per player, no folders)
--   * the bucket itself only accepts image/webp or image/jpeg and at most 512 KB (the app sends about 10-30 KB)
--   * a new picture needs an upload "ticket" from request_avatar_upload() (3 per day, banned players refused)
--   * a new or changed picture is "pending" and only its owner can see it until you approve it

do $$
begin
  if to_regprocedure('public.report_player(text,text)') is null
     or to_regclass('public.player_blocks') is null
     or to_regclass('storage.objects') is null
     or to_regclass('storage.buckets') is null then
    raise exception 'Run supabase/schema.sql and supabase/profiles_challenges.sql first, then run these parts in order.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Profile columns. avatar_status: none | pending | approved | rejected
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists avatar_status text not null default 'none' check (avatar_status in ('none', 'pending', 'approved', 'rejected')),
  add column if not exists avatar_version bigint,
  add column if not exists avatar_uploaded_at timestamptz,
  add column if not exists avatar_reviewed_at timestamptz,
  add column if not exists avatar_flag text check (avatar_flag is null or avatar_flag in ('reported'));

-- A signed-in player can read these two on their own row (the existing policy limits reads to that row).
grant select (avatar_status, avatar_version) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Upload log (3 uploads per player per day) and short-lived upload tickets
-- ---------------------------------------------------------------------------
create table if not exists public.avatar_uploads (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists avatar_uploads_user_time_idx on public.avatar_uploads (user_id, created_at desc);

create table if not exists public.avatar_tickets (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- ---------------------------------------------------------------------------
-- Reports on a picture (3 different players hide it until you review it) and the delete queue
-- ---------------------------------------------------------------------------
create table if not exists public.avatar_reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references auth.users (id) on delete cascade,
  target_id uuid not null references auth.users (id) on delete cascade,
  avatar_version bigint,
  created_at timestamptz not null default now(),
  check (reporter_id <> target_id)
);
create unique index if not exists avatar_reports_once_idx
  on public.avatar_reports (reporter_id, target_id, coalesce(avatar_version, 0));
create index if not exists avatar_reports_target_idx on public.avatar_reports (target_id, created_at desc);

-- Files waiting to be deleted from storage (the purge-avatars Edge Function empties this).
create table if not exists public.avatar_purge_queue (
  path text primary key,
  queued_at timestamptz not null default now()
);

alter table public.avatar_uploads enable row level security;
alter table public.avatar_tickets enable row level security;
alter table public.avatar_reports enable row level security;
alter table public.avatar_purge_queue enable row level security;
revoke all on public.avatar_uploads, public.avatar_tickets, public.avatar_reports, public.avatar_purge_queue from anon, authenticated;
-- No policies and no grants: players only reach these through the functions in parts 3 and 4.

-- ---------------------------------------------------------------------------
-- The storage bucket: private, one small image per player.
-- 524288 bytes = 512 KB. Storage itself refuses other file types and bigger files.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 524288, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 524288, allowed_mime_types = array['image/webp', 'image/jpeg'];

-- END OF PART 1 OF 5
