-- Tiebreaker profiles and challenges: PART 1 OF 5. Run the parts in order 1, 2, 3, 4, 5. Safe to run again.
-- Paste this whole part, from this line to the line that says END OF PART 1 OF 5.

-- Tiebreaker: editable player profiles, challenges, blocks and player reports.
--
-- RUN ORDER
--   1. supabase/schema.sql              (accounts, chat, reports, recovery, admin tools)  -- run this first, once
--   2. supabase/profiles_challenges.sql (this file)                                         -- then this, once
-- Both files are safe to run again. If you ever re-run schema.sql, run this file again after it.
--
-- Run this whole file: Supabase dashboard > SQL Editor > New query > paste > Run.
--
-- What it adds, in the order it runs (do not reorder)
--   1. a check that schema.sql has been run
--   2. profile fields on public.profiles: jersey, name tag, short bio, "open to challenges", optional stats
--   3. public.player_blocks     mute / block lists, enforced in the database (hides messages, stops challenges)
--   4. public.challenges        challenge invites (friendly room or online match), expire after 2 minutes
--   5. public.player_reports    "Report" on a player card; 5 different reporters hide the profile text
--   6. functions the app calls  update_my_profile, get_public_profile, touch_presence, send_challenge,
--                               respond_challenge, my_challenges, set_block, remove_block, my_blocks, report_player
--   7. realtime for challenges, admin tools and views
--
-- Nothing here stores an email, a real name, an age, a location or a wallet address.

-- ---------------------------------------------------------------------------
-- 1. Guard
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.messages') is null
     or to_regprocedure('public.contains_blocked_term(text)') is null
     or to_regprocedure('public.message_problem(text)') is null then
    raise exception 'Run supabase/schema.sql first, then run this file.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Profile fields (the username itself can never change)
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists jersey_color text not null default '#e5383b' check (jersey_color ~ '^#[0-9a-f]{6}$'),
  add column if not exists jersey_secondary text not null default '#f1f5f9' check (jersey_secondary ~ '^#[0-9a-f]{6}$'),
  add column if not exists jersey_pattern text not null default 'solid' check (jersey_pattern in ('solid', 'stripes', 'hoops', 'half', 'sash')),
  add column if not exists jersey_number smallint not null default 10 check (jersey_number between 1 and 99),
  add column if not exists name_tag text not null default '' check (char_length(name_tag) <= 12),
  add column if not exists bio text check (bio is null or char_length(bio) <= 60),
  add column if not exists open_to_challenges boolean not null default true,
  add column if not exists show_stats boolean not null default false,
  add column if not exists stat_wins integer check (stat_wins is null or stat_wins between 0 and 1000000),
  add column if not exists stat_streak integer check (stat_streak is null or stat_streak between 0 and 1000000),
  add column if not exists profile_hidden boolean not null default false,
  add column if not exists last_active_at timestamptz,
  add column if not exists profile_updated_at timestamptz;

-- A signed-in player may read the editable fields of their own row (the existing policy limits reads to that row).
grant select (jersey_color, jersey_secondary, jersey_pattern, jersey_number, name_tag, bio, open_to_challenges, show_stats, stat_wins, stat_streak)
  on public.profiles to authenticated;
-- Writes only go through update_my_profile(); there is no insert, update or delete grant.

-- ---------------------------------------------------------------------------
-- 3. Mute and block lists
--    mute  = I do not see their messages and they cannot challenge me
--    block = the same, and they cannot see my bio or stats
-- ---------------------------------------------------------------------------
create table if not exists public.player_blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'mute' check (kind in ('mute', 'block')),
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists player_blocks_blocked_idx on public.player_blocks (blocked_id);

alter table public.player_blocks enable row level security;
revoke all on public.player_blocks from anon, authenticated;
grant select (blocker_id, blocked_id, kind, created_at) on public.player_blocks to authenticated;
drop policy if exists "player_blocks: read own" on public.player_blocks;
create policy "player_blocks: read own" on public.player_blocks for select to authenticated using (blocker_id = auth.uid());

-- True when the signed-in reader muted or blocked this author. A function, so guests (who cannot read the table) still work.
create or replace function public.author_blocked(p_author uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select auth.uid() is not null
     and exists (select 1 from public.player_blocks b where b.blocker_id = auth.uid() and b.blocked_id = p_author)
$$;
revoke execute on function public.author_blocked(uuid) from public;
grant execute on function public.author_blocked(uuid) to anon, authenticated;

-- Chat: hide messages from players I muted or blocked. A restrictive policy is added to the existing ones, so
-- re-running schema.sql does not remove it.
drop policy if exists "messages: hide authors I muted" on public.messages;
create policy "messages: hide authors I muted" on public.messages
  as restrictive for select to anon, authenticated using (not public.author_blocked(user_id));

-- END OF PART 1 OF 5
