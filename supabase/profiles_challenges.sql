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

-- ---------------------------------------------------------------------------
-- 4. Challenges
--    mode 'friendly' = a wallet-free friend room (room_code is the room id, like tbk3m9x2qa)
--    mode 'online'   = a private two-wallet match (room_code is the join code, match_id is the match number)
--    The invite carries no private data: only who sent it and the room code.
-- ---------------------------------------------------------------------------
create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users (id) on delete cascade,
  receiver_id uuid not null references auth.users (id) on delete cascade,
  mode text not null check (mode in ('friendly', 'online')),
  room_code text not null check (room_code ~ '^(tb[a-z0-9]{8}|0x[0-9a-f]{64})$'),
  match_id numeric(20, 0) check (match_id is null or match_id between 1 and 999999999999999999),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired', 'busy', 'cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 minutes'),
  responded_at timestamptz,
  check (sender_id <> receiver_id),
  check ((mode = 'online') = (match_id is not null))
);
create index if not exists challenges_sender_idx on public.challenges (sender_id, created_at desc);
create index if not exists challenges_receiver_idx on public.challenges (receiver_id, created_at desc);
-- At most one pending challenge per sender, enforced by the database itself.
create unique index if not exists challenges_one_pending_per_sender on public.challenges (sender_id) where status = 'pending';

alter table public.challenges enable row level security;
revoke all on public.challenges from anon, authenticated;
grant select (id, sender_id, receiver_id, mode, room_code, match_id, status, created_at, expires_at, responded_at) on public.challenges to authenticated;
drop policy if exists "challenges: read mine" on public.challenges;
create policy "challenges: read mine" on public.challenges for select to authenticated
  using (sender_id = auth.uid() or receiver_id = auth.uid());
-- No insert, update or delete policy: everything goes through send_challenge() and respond_challenge().

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'challenges') then
    alter publication supabase_realtime add table public.challenges;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Reports on a player (the Report button on a profile card)
-- ---------------------------------------------------------------------------
create table if not exists public.player_reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references auth.users (id) on delete cascade,
  target_id uuid not null references auth.users (id) on delete cascade,
  reason text check (reason is null or char_length(reason) <= 100),
  created_at timestamptz not null default now(),
  unique (reporter_id, target_id),
  check (reporter_id <> target_id)
);
alter table public.player_reports enable row level security;
revoke all on public.player_reports from anon, authenticated;
-- No policies and no grants: players write through report_player(); you read the admin_player_reports view.

-- Five different players reporting someone hides their bio and name tag until you review it.
create or replace function public.player_reports_after_insert() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (select count(distinct reporter_id) from public.player_reports where target_id = new.target_id) >= 5 then
    update public.profiles set profile_hidden = true where id = new.target_id;
  end if;
  return null;
end
$$;
revoke execute on function public.player_reports_after_insert() from public, anon, authenticated;
drop trigger if exists player_reports_after_insert on public.player_reports;
create trigger player_reports_after_insert after insert on public.player_reports
  for each row execute function public.player_reports_after_insert();

-- ---------------------------------------------------------------------------
-- 6a. Edit my profile. The same filters as chat: no links, emails or phone numbers, profanity check.
-- ---------------------------------------------------------------------------
create or replace function public.update_my_profile(
  p_color text, p_secondary text, p_pattern text, p_number int, p_tag text, p_bio text,
  p_open boolean, p_show_stats boolean, p_wins int default null, p_streak int default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  prof public.profiles;
  colors constant text[] := array['#e5383b','#fb5607','#ffb703','#c6ff3d','#06d6a0','#2ec4b6','#38bdf8','#3a86ff',
                                  '#4f46e5','#8338ec','#ff4d9d','#f1f5f9','#9b1c31','#d4a017','#94a3b8','#111827'];
  v_tag text := regexp_replace(btrim(coalesce(p_tag, '')), '\s+', ' ', 'g');
  v_bio text := regexp_replace(btrim(coalesce(p_bio, '')), '\s+', ' ', 'g');
  problem text;
begin
  if me is null then raise exception 'not_signed_in'; end if;
  select * into prof from public.profiles where id = me;
  if prof.id is null then raise exception 'profile_missing'; end if;
  if prof.banned then raise exception 'profile_banned'; end if;
  if prof.profile_updated_at is not null and prof.profile_updated_at > clock_timestamp() - interval '2 seconds' then
    raise exception 'profile_rate';
  end if;

  if p_color is null or p_secondary is null or not (lower(p_color) = any (colors)) or not (lower(p_secondary) = any (colors)) then
    raise exception 'profile_bad_color';
  end if;
  if p_pattern is null or p_pattern not in ('solid', 'stripes', 'hoops', 'half', 'sash') then raise exception 'profile_bad_pattern'; end if;
  if p_number is null or p_number < 1 or p_number > 99 then raise exception 'profile_bad_number'; end if;

  -- Name tag: up to 12 letters, digits, spaces and . , ' ! ? _ -
  if v_tag <> '' then
    if char_length(v_tag) > 12 then raise exception 'profile_tag_long'; end if;
    if v_tag !~ '^[A-Za-z0-9\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F\u0400-\u04FF .,''!?_-]+$'
       or v_tag !~ '[A-Za-z0-9\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F\u0400-\u04FF]' then
      raise exception 'profile_tag_chars';
    end if;
    problem := public.message_problem(v_tag);
    if problem is not null or public.contains_blocked_term(v_tag) then raise exception 'profile_tag_blocked'; end if;
  end if;

  -- Bio: up to 60 characters of the same kind of text as a chat message.
  if v_bio <> '' then
    if char_length(v_bio) > 60 then raise exception 'profile_bio_long'; end if;
    problem := public.message_problem(v_bio);
    if problem is not null then raise exception 'profile_bio_%', problem; end if;
    if public.contains_blocked_term(v_bio) then raise exception 'profile_bio_word'; end if;
  end if;

  update public.profiles set
    jersey_color = lower(p_color),
    jersey_secondary = lower(p_secondary),
    jersey_pattern = p_pattern,
    jersey_number = p_number,
    name_tag = v_tag,
    bio = nullif(v_bio, ''),
    open_to_challenges = coalesce(p_open, true),
    show_stats = coalesce(p_show_stats, false),
    -- Stats are shared only when switched on. Without new numbers the last shared ones stay.
    stat_wins = case when coalesce(p_show_stats, false) then coalesce(least(greatest(p_wins, 0), 1000000), prof.stat_wins, 0) end,
    stat_streak = case when coalesce(p_show_stats, false) then coalesce(least(greatest(p_streak, 0), 1000000), prof.stat_streak, 0) end,
    profile_updated_at = clock_timestamp()
  where id = me;
end
$$;
revoke execute on function public.update_my_profile(text, text, text, int, text, text, boolean, boolean, int, int) from public, anon;
grant execute on function public.update_my_profile(text, text, text, int, text, text, boolean, boolean, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 6b. "Available" hint: the app pings this once a minute while it is open. Nothing else about presence is stored or shown.
-- ---------------------------------------------------------------------------
create or replace function public.touch_presence() returns void
language sql security definer set search_path = public
as $$
  update public.profiles set last_active_at = now()
  where id = auth.uid() and (last_active_at is null or last_active_at < now() - interval '20 seconds')
$$;
revoke execute on function public.touch_presence() from public, anon;
grant execute on function public.touch_presence() to authenticated;

-- ---------------------------------------------------------------------------
-- 6c. The public profile card. Returns no id, no email and no wallet address.
-- ---------------------------------------------------------------------------
create or replace function public.get_public_profile(p_username text)
returns table (
  username text, joined_at timestamptz, jersey_color text, jersey_secondary text, jersey_pattern text, jersey_number int,
  name_tag text, bio text, open_to_challenges boolean, available boolean, banned boolean, challenges_played int,
  ranked_wins int, win_streak int, my_relation text, is_me boolean, blocked_me boolean
)
language plpgsql stable security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  p public.profiles;
  hide_text boolean;
  they_blocked boolean;
begin
  if me is null then raise exception 'not_signed_in'; end if;
  select * into p from public.profiles pr where pr.username_lower = lower(coalesce(p_username, ''));
  if p.id is null then return; end if;
  they_blocked := exists (select 1 from public.player_blocks b where b.blocker_id = p.id and b.blocked_id = me and b.kind = 'block');
  hide_text := p.banned or p.profile_hidden or they_blocked;
  return query select
    p.username,
    p.created_at,
    case when p.banned then '#e5383b' else p.jersey_color end,
    case when p.banned then '#f1f5f9' else p.jersey_secondary end,
    case when p.banned then 'solid' else p.jersey_pattern end,
    (case when p.banned then 10 else p.jersey_number end)::int,
    case when hide_text then '' else p.name_tag end,
    case when hide_text then null else p.bio end,
    p.open_to_challenges,
    (not p.banned) and p.open_to_challenges and p.last_active_at is not null and p.last_active_at > now() - interval '3 minutes',
    p.banned,
    (select count(*)::int from public.challenges c where c.status = 'accepted' and (c.sender_id = p.id or c.receiver_id = p.id)),
    case when p.show_stats and not hide_text then p.stat_wins end,
    case when p.show_stats and not hide_text then p.stat_streak end,
    (select b.kind from public.player_blocks b where b.blocker_id = me and b.blocked_id = p.id),
    p.id = me,
    they_blocked;
end
$$;
revoke execute on function public.get_public_profile(text) from public, anon;
grant execute on function public.get_public_profile(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6d. Send a challenge. Every abuse rule lives here, in the database.
-- ---------------------------------------------------------------------------
create or replace function public.send_challenge(p_to text, p_mode text, p_room text, p_match_id numeric default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  sender public.profiles;
  recv public.profiles;
  new_id uuid;
begin
  if me is null then raise exception 'not_signed_in'; end if;
  -- One challenge at a time per sender, even with several tabs open.
  perform pg_advisory_xact_lock(hashtextextended(me::text, 7));

  select * into sender from public.profiles where id = me;
  if sender.id is null then raise exception 'challenge_no_profile'; end if;
  if sender.banned then raise exception 'challenge_sender_banned'; end if;

  if p_mode not in ('friendly', 'online') then raise exception 'challenge_bad_mode'; end if;
  if p_mode = 'friendly' and (p_room is null or p_room !~ '^tb[a-z0-9]{8}$' or p_match_id is not null) then
    raise exception 'challenge_bad_room';
  end if;
  if p_mode = 'online' and (p_room is null or p_room !~ '^0x[0-9a-f]{64}$' or p_match_id is null or p_match_id < 1 or p_match_id > 999999999999999999) then
    raise exception 'challenge_bad_room';
  end if;

  -- Rate limits: 5 per minute and 30 per day, whatever happened to the earlier ones.
  if (select count(*) from public.challenges where sender_id = me and created_at > now() - interval '60 seconds') >= 5 then
    raise exception 'challenge_rate_minute';
  end if;
  if (select count(*) from public.challenges where sender_id = me and created_at > now() - interval '24 hours') >= 30 then
    raise exception 'challenge_rate_day';
  end if;

  select * into recv from public.profiles where username_lower = lower(coalesce(p_to, ''));
  if recv.id is null then raise exception 'challenge_unknown_player'; end if;
  if recv.id = me then raise exception 'challenge_self'; end if;
  if recv.banned then raise exception 'challenge_receiver_banned'; end if;
  if exists (select 1 from public.player_blocks where (blocker_id = recv.id and blocked_id = me) or (blocker_id = me and blocked_id = recv.id)) then
    raise exception 'challenge_blocked';
  end if;
  if not recv.open_to_challenges then raise exception 'challenge_closed'; end if;
  if recv.last_active_at is null or recv.last_active_at < now() - interval '5 minutes' then raise exception 'challenge_unavailable'; end if;

  -- A challenge nobody answered in 2 minutes is expired, so it no longer counts as pending.
  update public.challenges set status = 'expired', responded_at = now()
   where sender_id = me and status = 'pending' and expires_at <= now();
  if exists (select 1 from public.challenges where sender_id = me and status = 'pending') then
    raise exception 'challenge_pending';
  end if;

  -- 60 second cooldown after this player declined me.
  if exists (select 1 from public.challenges
              where sender_id = me and receiver_id = recv.id and status = 'declined'
                and responded_at > now() - interval '60 seconds') then
    raise exception 'challenge_cooldown';
  end if;

  begin
    insert into public.challenges (sender_id, receiver_id, mode, room_code, match_id)
    values (me, recv.id, p_mode, p_room, case when p_mode = 'online' then p_match_id end)
    returning id into new_id;
  exception when unique_violation then
    raise exception 'challenge_pending';
  end;
  return new_id;
end
$$;
revoke execute on function public.send_challenge(text, text, text, numeric) from public, anon;
grant execute on function public.send_challenge(text, text, text, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 6e. Answer or cancel a challenge. Returns the status it ended up with.
--     accept / decline / busy: the receiver.  cancel: the sender.
-- ---------------------------------------------------------------------------
create or replace function public.respond_challenge(p_id uuid, p_action text) returns text
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.challenges;
  new_status text;
begin
  if me is null then raise exception 'not_signed_in'; end if;
  if p_action not in ('accept', 'decline', 'busy', 'cancel') then raise exception 'challenge_bad_action'; end if;
  select * into c from public.challenges where id = p_id for update;
  if c.id is null or (c.sender_id <> me and c.receiver_id <> me) then raise exception 'challenge_not_found'; end if;
  if (p_action = 'cancel' and c.sender_id <> me) or (p_action <> 'cancel' and c.receiver_id <> me) then
    raise exception 'challenge_not_yours';
  end if;
  if c.status <> 'pending' then return c.status; end if; -- already answered: report where it stands
  if c.expires_at <= now() then
    update public.challenges set status = 'expired', responded_at = now() where id = c.id;
    return 'expired';
  end if;
  if p_action = 'accept' and exists (select 1 from public.profiles where id = me and banned) then
    raise exception 'challenge_sender_banned';
  end if;
  new_status := case p_action when 'accept' then 'accepted' when 'decline' then 'declined' when 'busy' then 'busy' else 'cancelled' end;
  update public.challenges set status = new_status, responded_at = now() where id = c.id;
  return new_status;
end
$$;
revoke execute on function public.respond_challenge(uuid, text) from public, anon;
grant execute on function public.respond_challenge(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6f. My recent challenges (last 10 minutes), with the other player's username.
-- ---------------------------------------------------------------------------
create or replace function public.my_challenges()
returns table (
  id uuid, direction text, other_username text, mode text, room_code text, match_id numeric,
  status text, created_at timestamptz, expires_at timestamptz, responded_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not_signed_in'; end if;
  update public.challenges ch set status = 'expired', responded_at = now()
   where ch.status = 'pending' and ch.expires_at <= now() and (ch.sender_id = me or ch.receiver_id = me);
  return query
    select c.id,
           case when c.sender_id = me then 'out' else 'in' end,
           o.username,
           c.mode, c.room_code, c.match_id, c.status, c.created_at, c.expires_at, c.responded_at
      from public.challenges c
      join public.profiles o on o.id = case when c.sender_id = me then c.receiver_id else c.sender_id end
     where (c.sender_id = me or c.receiver_id = me)
       and c.created_at > now() - interval '10 minutes'
     order by c.created_at desc
     limit 20;
end
$$;
revoke execute on function public.my_challenges() from public, anon;
grant execute on function public.my_challenges() to authenticated;

-- ---------------------------------------------------------------------------
-- 6g. Mute, block, unblock
-- ---------------------------------------------------------------------------
create or replace function public.set_block(p_username text, p_kind text default 'block') returns void
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  target uuid;
begin
  if me is null then raise exception 'not_signed_in'; end if;
  if p_kind not in ('mute', 'block') then raise exception 'block_bad_kind'; end if;
  select id into target from public.profiles where username_lower = lower(coalesce(p_username, ''));
  if target is null then raise exception 'block_unknown_player'; end if;
  if target = me then raise exception 'block_self'; end if;
  if (select count(*) from public.player_blocks where blocker_id = me) >= 200
     and not exists (select 1 from public.player_blocks where blocker_id = me and blocked_id = target) then
    raise exception 'block_limit';
  end if;
  insert into public.player_blocks (blocker_id, blocked_id, kind) values (me, target, p_kind)
  on conflict (blocker_id, blocked_id) do update set kind = excluded.kind;
  -- Anything still waiting between the two of us is called off.
  update public.challenges set status = 'cancelled', responded_at = now()
   where status = 'pending' and ((sender_id = me and receiver_id = target) or (sender_id = target and receiver_id = me));
end
$$;
revoke execute on function public.set_block(text, text) from public, anon;
grant execute on function public.set_block(text, text) to authenticated;

create or replace function public.remove_block(p_username text) returns void
language sql security definer set search_path = public
as $$
  delete from public.player_blocks
   where blocker_id = auth.uid()
     and blocked_id = (select id from public.profiles where username_lower = lower(coalesce(p_username, '')))
$$;
revoke execute on function public.remove_block(text) from public, anon;
grant execute on function public.remove_block(text) to authenticated;

create or replace function public.my_blocks() returns table (username text, kind text, created_at timestamptz, blocked_id uuid)
language sql stable security definer set search_path = public
as $$
  select p.username, b.kind, b.created_at, b.blocked_id
    from public.player_blocks b join public.profiles p on p.id = b.blocked_id
   where b.blocker_id = auth.uid()
   order by b.created_at desc
$$;
revoke execute on function public.my_blocks() from public, anon;
grant execute on function public.my_blocks() to authenticated;

-- ---------------------------------------------------------------------------
-- 6h. Report a player (profile text or challenge behaviour). At most 5 reports an hour.
-- ---------------------------------------------------------------------------
create or replace function public.report_player(p_username text, p_reason text default null) returns void
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  target uuid;
begin
  if me is null then raise exception 'not_signed_in'; end if;
  select id into target from public.profiles where username_lower = lower(coalesce(p_username, ''));
  if target is null then raise exception 'report_unknown_player'; end if;
  if target = me then raise exception 'report_self'; end if;
  if p_reason is not null and char_length(p_reason) > 100 then raise exception 'report_reason_long'; end if;
  if (select count(*) from public.player_reports where reporter_id = me and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'report_rate';
  end if;
  insert into public.player_reports (reporter_id, target_id, reason) values (me, target, p_reason)
  on conflict (reporter_id, target_id) do nothing; -- reporting the same player twice is fine: it is already on file
end
$$;
revoke execute on function public.report_player(text, text) from public, anon;
grant execute on function public.report_player(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Owner tools (SQL Editor, as the project owner). Players cannot call these.
--   select * from public.admin_player_reports order by reported_at desc;
--   select public.admin_hide_profile('somename');      -- hide bio, name tag and stats
--   select public.admin_unhide_profile('somename');
--   select public.admin_clear_profile('somename');     -- reset jersey, name tag and bio to defaults
--   select public.admin_ban_user('somename', 'spam');  -- from schema.sql: bans, hides messages, blocks sign-in
-- ---------------------------------------------------------------------------
create or replace function public.admin_hide_profile(p_username text) returns void
language sql security definer set search_path = public
as $$ update public.profiles set profile_hidden = true where username_lower = lower(p_username) $$;

create or replace function public.admin_unhide_profile(p_username text) returns void
language sql security definer set search_path = public
as $$ update public.profiles set profile_hidden = false where username_lower = lower(p_username) $$;

create or replace function public.admin_clear_profile(p_username text) returns void
language sql security definer set search_path = public
as $$
  update public.profiles set
    jersey_color = '#e5383b', jersey_secondary = '#f1f5f9', jersey_pattern = 'solid', jersey_number = 10,
    name_tag = '', bio = null, show_stats = false, stat_wins = null, stat_streak = null
  where username_lower = lower(p_username)
$$;

revoke execute on function public.admin_hide_profile(text) from public, anon, authenticated;
revoke execute on function public.admin_unhide_profile(text) from public, anon, authenticated;
revoke execute on function public.admin_clear_profile(text) from public, anon, authenticated;
grant execute on function public.admin_hide_profile(text), public.admin_unhide_profile(text), public.admin_clear_profile(text) to service_role;

create or replace view public.admin_player_reports as
  select r.id as report_id, r.created_at as reported_at, r.reason,
         t.username as reported_player, t.bio, t.name_tag, t.profile_hidden, t.banned,
         s.username as reported_by
  from public.player_reports r
  join public.profiles t on t.id = r.target_id
  join public.profiles s on s.id = r.reporter_id;
revoke all on public.admin_player_reports from public, anon, authenticated;
grant select on public.admin_player_reports to service_role;

-- Optional clean-up of old challenges (Database > Extensions > enable pg_cron, then):
--   select cron.schedule('trim-challenges', '15 4 * * *', $$delete from public.challenges where created_at < now() - interval '7 days'$$);
