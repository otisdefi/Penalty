-- Tiebreaker: accounts, chat and moderation for Supabase.
--
-- Run this whole file once: Supabase dashboard > SQL Editor > New query > paste > Run.
-- It is safe to run again (everything is "create or replace" / "if not exists").
--
-- What it sets up, in the order it runs (do not reorder: each part uses the ones above it)
--   1. private schema           a schema the API cannot reach (holds the recovery hashes)
--   2. profiles                 the public username of each account (no email, no real name, nothing else)
--   3. blocked_terms + checks   the profanity list the database uses (you can add words to it)
--   4. sign-up trigger          creates the profile, refuses anything that is not a username sign-up
--   5. messages                 lobby, friend-room and match chat, with Row Level Security and grants
--   6. message rules            200 characters, no links / emails / phone numbers, profanity check,
--                               banned users, 1 message per 2 seconds and 20 per minute
--   7. realtime                 live updates for messages
--   8. reports                  "Report" button submissions, auto-hide after 5 different reporters
--   9. recovery                 a hash of each player's one-time recovery code (the code is never stored)
--  10. delete my account
--  11. admin_* functions and a view, for you (the owner) to hide messages and ban players
--
-- Players sign up with a username and password only. The app turns the username into a placeholder
-- identity on the domain players.tiebreaker.invalid (the username, then an at sign, then that domain).
-- ".invalid" is never an inbox, so no email is collected, stored or shown.

-- ---------------------------------------------------------------------------
-- Private schema (not reachable through the API)
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Profiles: the public username
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_]{3,12}$'),
  username_lower text generated always as (lower(username)) stored,
  banned boolean not null default false,
  banned_reason text,
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_username_lower_key on public.profiles (username_lower);

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select (id, username, created_at) on public.profiles to authenticated;
drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles for select to authenticated using (id = auth.uid());

-- ---------------------------------------------------------------------------
-- Profanity list (the database checks messages and usernames against it)
-- whole_word = true: only blocks the word on its own, so "class" or "title" stay fine.
-- ---------------------------------------------------------------------------
create table if not exists public.blocked_terms (
  term text primary key,
  whole_word boolean not null default false
);
alter table public.blocked_terms enable row level security;
revoke all on public.blocked_terms from anon, authenticated;

insert into public.blocked_terms (term, whole_word) values
  -- English
  ('fuck', false), ('shit', false), ('bitch', false), ('cunt', false), ('whore', false), ('slut', false),
  ('penis', false), ('vagina', false), ('pussy', false), ('asshole', false), ('bastard', false), ('nigg', false),
  ('fagg', false), ('retard', false), ('nazi', false), ('hitler', false), ('porn', false), ('sexy', false),
  ('suicide', false), ('molest', false), ('pedo', false), ('twat', false), ('wank', false),
  ('ass', true), ('sex', true), ('cum', true), ('tit', true), ('tits', true), ('fck', true), ('wtf', true),
  ('kkk', true), ('dik', true), ('dick', true), ('cock', true), ('rape', true), ('kill', true), ('nude', true),
  ('hoe', true), ('fag', true), ('pimp', true),
  -- Turkish
  ('orospu', false), ('siktir', false), ('yarrak', false), ('amcik', false), ('sikik', false), ('gotveren', false),
  ('pezevenk', false), ('kahpe', false), ('ibne', true), ('amk', true),
  -- Spanish
  ('mierda', false), ('cabron', false), ('pendejo', false), ('joder', false), ('gilipollas', false),
  ('maricon', false), ('chingad', false), ('puta', true), ('puto', true), ('verga', true), ('pinche', true), ('cono', true),
  -- Portuguese
  ('caralho', false), ('buceta', false), ('foder', false), ('fodase', false), ('viado', false), ('merda', false),
  ('cacete', false), ('porra', true),
  -- Russian
  ('блят', false), ('бляд', false), ('хуи', false), ('пизд', false), ('ебан', false), ('ебат', false), ('ебал', false),
  ('залуп', false), ('мудак', false), ('мудил', false), ('пидор', false), ('пидар', false), ('гондон', false),
  ('шлюх', false), ('дроч', false), ('сука', true), ('бля', true)
on conflict (term) do nothing;

-- Lower-cases, folds accents (including Turkish and Russian letters) and common look-alikes (0 1 3 4 5 7 8 @ $ !).
create or replace function public.fold_text(t text) returns text
language sql immutable set search_path = ''
as $$
  select translate(
    translate(lower(t), 'ığşçöüñáàâäãåéèêëíìîïóòôõúùûýÿйё', 'igscounaaaaaaeeeeiiiioooouuuyyие'),
    '0134578@$!', 'oieastbasi')
$$;

create or replace function public.contains_blocked_term(t text) returns boolean
language sql stable set search_path = public
as $$
  with flat as (
    select regexp_replace(regexp_replace(public.fold_text(t), '[^a-zа-я]', '', 'g'), '(.)\1+', '\1', 'g') as s
  )
  select
    exists (
      select 1 from public.blocked_terms b, flat
      where not b.whole_word
        and position(regexp_replace(public.fold_text(b.term), '(.)\1+', '\1', 'g') in flat.s) > 0
    )
    or exists (
      select 1
      from regexp_split_to_table(lower(t), '[\s.,;:!?()\[\]{}"''\-_/\\|+*=<>~`^&%#]+') as tok,
           public.blocked_terms b
      where b.whole_word
        and tok <> ''
        and regexp_replace(regexp_replace(public.fold_text(tok), '[^a-zа-я]', '', 'g'), '(.)\1{2,}', '\1\1', 'g')
            = public.fold_text(b.term)
    )
$$;

-- Helpers used by the triggers. Players cannot call them directly.
revoke execute on function public.fold_text(text) from public, anon, authenticated;
revoke execute on function public.contains_blocked_term(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Create the profile when an account is created (and refuse anything that is not a username sign-up)
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  name text := new.raw_user_meta_data ->> 'username';
begin
  if name is null or name !~ '^[A-Za-z0-9_]{3,12}$' then
    raise exception 'invalid_username';
  end if;
  -- Only the placeholder identity is accepted, so a real email address can never be stored.
  if lower(new.email) <> lower(name) || '@players.tiebreaker.invalid' then
    raise exception 'invalid_identity';
  end if;
  if public.contains_blocked_term(name) then
    raise exception 'blocked_username';
  end if;
  insert into public.profiles (id, username) values (new.id, name);
  return new;
end
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Lets the sign-up screen say "taken" before the player types a password.
create or replace function public.username_available(p_name text) returns boolean
language sql stable security definer set search_path = public
as $$
  select p_name ~ '^[A-Za-z0-9_]{3,12}$'
     and not public.contains_blocked_term(p_name)
     and not exists (select 1 from public.profiles where username_lower = lower(p_name))
$$;
revoke execute on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  channel text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  username text not null,
  body text not null,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists messages_channel_id_idx on public.messages (channel, id desc);
create index if not exists messages_user_time_idx on public.messages (user_id, created_at desc);

alter table public.messages enable row level security;
revoke all on public.messages from anon, authenticated;
grant select (id, channel, user_id, username, body, created_at) on public.messages to anon, authenticated;
grant insert (channel, body, user_id) on public.messages to authenticated;

drop policy if exists "messages: anyone reads visible" on public.messages;
create policy "messages: anyone reads visible" on public.messages
  for select to anon, authenticated using (hidden = false);

drop policy if exists "messages: insert only your own" on public.messages;
create policy "messages: insert only your own" on public.messages
  for insert to authenticated with check (user_id = auth.uid());
-- No update or delete policy: players cannot edit or remove messages. Owners use the admin_* functions.

-- Why a message is not allowed, or null when it is fine. Mirrors the checks in the app.
-- (Granted to nobody directly; the insert trigger below runs it.)
create or replace function public.message_problem(b text) returns text
language sql immutable set search_path = ''
as $$
  select case
    when b is null or char_length(btrim(b)) = 0 then 'empty'
    when char_length(b) > 200 then 'too_long'
    when b ~ '[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]' then 'bad_chars'
    when b ~* '(https?:|ftp:|www\.|://|t\.me|bit\.ly|wa\.me|discord|telegram|whatsapp)' then 'link'
    when b ~* '[a-z0-9-]\.(com|net|org|io|xyz|gg|me|app|co|ly|eth|link|info|biz|ru|cn|tk|dev|site|online|shop|store|club|top|vip|cc|tv|ws|gl|gd|ai)([^a-z0-9]|$)' then 'link'
    when b ~* '(dot|d0t)\s*(com|net|org|io)' then 'link'
    when b ~ '@' or b ~* '\((at)\)|\[(at)\]' then 'email'
    when b ~ '(\d[\s().+-]*){7,}' then 'phone'
    else null
  end
$$;

revoke execute on function public.message_problem(text) from public, anon, authenticated;

create or replace function public.messages_before_insert() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  p public.profiles;
  problem text;
  recent int;
begin
  if auth.uid() is null or new.user_id is distinct from auth.uid() then
    raise exception 'chat_not_allowed';
  end if;
  select * into p from public.profiles where id = auth.uid();
  if p.id is null then raise exception 'chat_no_profile'; end if;
  if p.banned then raise exception 'chat_banned'; end if;
  if new.channel !~ '^(lobby|room:[a-z0-9]{10}|match:[0-9]{1,18})$' then raise exception 'chat_bad_channel'; end if;

  new.body := regexp_replace(btrim(coalesce(new.body, '')), '\s+', ' ', 'g');
  problem := public.message_problem(new.body);
  if problem is not null then raise exception 'chat_%', problem; end if;
  if public.contains_blocked_term(new.body) then raise exception 'chat_blocked_word'; end if;

  -- Rate limit: one message every 2 seconds and 20 per minute per player.
  if exists (select 1 from public.messages where user_id = p.id and created_at > clock_timestamp() - interval '2 seconds') then
    raise exception 'chat_rate_2s';
  end if;
  select count(*) into recent from public.messages where user_id = p.id and created_at > clock_timestamp() - interval '60 seconds';
  if recent >= 20 then raise exception 'chat_rate_minute'; end if;

  -- The server decides these, whatever the client sent.
  new.username := p.username;
  new.hidden := false;
  new.created_at := clock_timestamp();
  return new;
end
$$;
revoke execute on function public.messages_before_insert() from public, anon, authenticated;

drop trigger if exists messages_before_insert on public.messages;
create trigger messages_before_insert before insert on public.messages
  for each row execute function public.messages_before_insert();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Reports (the Report button)
-- ---------------------------------------------------------------------------
create table if not exists public.reports (
  id bigint generated always as identity primary key,
  message_id bigint not null references public.messages (id) on delete cascade,
  reporter_id uuid not null references auth.users (id) on delete cascade,
  reason text check (reason is null or char_length(reason) <= 100),
  created_at timestamptz not null default now(),
  unique (message_id, reporter_id)
);
alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;
grant insert (message_id, reporter_id, reason) on public.reports to authenticated;
drop policy if exists "reports: insert your own" on public.reports;
create policy "reports: insert your own" on public.reports
  for insert to authenticated with check (reporter_id = auth.uid());
-- No select policy: players cannot read reports. You read them with the admin_reports view.

-- A message reported by 5 different players is hidden automatically until you review it.
create or replace function public.reports_after_insert() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (select count(distinct reporter_id) from public.reports where message_id = new.message_id) >= 5 then
    update public.messages set hidden = true where id = new.message_id;
  end if;
  return null;
end
$$;
revoke execute on function public.reports_after_insert() from public, anon, authenticated;
drop trigger if exists reports_after_insert on public.reports;
create trigger reports_after_insert after insert on public.reports
  for each row execute function public.reports_after_insert();

-- ---------------------------------------------------------------------------
-- Recovery codes (only a hash is stored)
-- ---------------------------------------------------------------------------
create table if not exists private.recovery (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  failed_attempts int not null default 0,
  window_start timestamptz
);

-- A signed-in player stores the hash of their new recovery code.
create or replace function public.set_recovery_hash(p_hash text) returns void
language plpgsql security definer set search_path = public, private
as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_hash'; end if;
  insert into private.recovery (user_id, code_hash, failed_attempts, window_start)
  values (auth.uid(), p_hash, 0, null)
  on conflict (user_id) do update
    set code_hash = excluded.code_hash, created_at = now(), failed_attempts = 0, window_start = null;
end
$$;
revoke execute on function public.set_recovery_hash(text) from public, anon;
grant execute on function public.set_recovery_hash(text) to authenticated;

-- Used only by the reset-password Edge Function (service role). Returns the user id when the code is right.
-- Five wrong guesses lock the account's reset for 15 minutes.
create or replace function public.check_recovery(p_username text, p_hash text) returns uuid
language plpgsql security definer set search_path = public, private
as $$
declare
  uid uuid;
  r private.recovery;
begin
  select id into uid from public.profiles where username_lower = lower(coalesce(p_username, ''));
  if uid is null then return null; end if;
  select * into r from private.recovery where user_id = uid for update;
  if r.user_id is null then return null; end if;

  if r.window_start is null or r.window_start < now() - interval '15 minutes' then
    r.failed_attempts := 0;
    r.window_start := null;
  end if;
  if r.failed_attempts >= 5 then raise exception 'recovery_locked'; end if;

  if r.code_hash = p_hash then
    update private.recovery set failed_attempts = 0, window_start = null where user_id = uid;
    return uid;
  end if;

  update private.recovery
     set failed_attempts = r.failed_attempts + 1, window_start = coalesce(r.window_start, now())
   where user_id = uid;
  return null;
end
$$;
revoke execute on function public.check_recovery(text, text) from public, anon, authenticated;
grant execute on function public.check_recovery(text, text) to service_role;

create or replace function public.replace_recovery_hash(p_user uuid, p_hash text) returns void
language plpgsql security definer set search_path = public, private
as $$
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_hash'; end if;
  insert into private.recovery (user_id, code_hash) values (p_user, p_hash)
  on conflict (user_id) do update
    set code_hash = excluded.code_hash, created_at = now(), failed_attempts = 0, window_start = null;
end
$$;
revoke execute on function public.replace_recovery_hash(uuid, text) from public, anon, authenticated;
grant execute on function public.replace_recovery_hash(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Delete my account and messages
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  delete from public.messages where user_id = auth.uid();
  delete from auth.users where id = auth.uid(); -- also removes the profile, recovery code and reports
end
$$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------------------
-- Owner tools. Run these in the SQL Editor (as the project owner); players cannot call them.
--   select public.admin_hide_message(123);
--   select public.admin_unhide_message(123);
--   select public.admin_ban_user('somename', 'spam');
--   select public.admin_unban_user('somename');
--   select * from public.admin_reports order by created_at desc;
-- ---------------------------------------------------------------------------
create or replace function public.admin_hide_message(p_id bigint) returns void
language sql security definer set search_path = public
as $$ update public.messages set hidden = true where id = p_id $$;

create or replace function public.admin_unhide_message(p_id bigint) returns void
language sql security definer set search_path = public
as $$ update public.messages set hidden = false where id = p_id $$;

create or replace function public.admin_ban_user(p_username text, p_reason text default null) returns void
language plpgsql security definer set search_path = public
as $$
declare uid uuid;
begin
  select id into uid from public.profiles where username_lower = lower(p_username);
  if uid is null then raise exception 'unknown_user'; end if;
  update public.profiles set banned = true, banned_reason = p_reason where id = uid;
  update public.messages set hidden = true where user_id = uid;
  update auth.users set banned_until = 'infinity' where id = uid; -- also blocks signing in
end
$$;

create or replace function public.admin_unban_user(p_username text) returns void
language plpgsql security definer set search_path = public
as $$
declare uid uuid;
begin
  select id into uid from public.profiles where username_lower = lower(p_username);
  if uid is null then raise exception 'unknown_user'; end if;
  update public.profiles set banned = false, banned_reason = null where id = uid;
  update auth.users set banned_until = null where id = uid;
end
$$;

revoke execute on function public.admin_hide_message(bigint) from public, anon, authenticated;
revoke execute on function public.admin_unhide_message(bigint) from public, anon, authenticated;
revoke execute on function public.admin_ban_user(text, text) from public, anon, authenticated;
revoke execute on function public.admin_unban_user(text) from public, anon, authenticated;
grant execute on function public.admin_hide_message(bigint), public.admin_unhide_message(bigint),
  public.admin_ban_user(text, text), public.admin_unban_user(text) to service_role;

create or replace view public.admin_reports as
  select r.id as report_id, r.created_at as reported_at, r.reason,
         m.id as message_id, m.username, m.body, m.hidden, m.channel
  from public.reports r join public.messages m on m.id = r.message_id;
revoke all on public.admin_reports from public, anon, authenticated;
grant select on public.admin_reports to service_role;
