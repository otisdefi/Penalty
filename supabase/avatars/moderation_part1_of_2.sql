-- Tiebreaker automatic picture checks: PART 1 OF 2. Run the parts in order 1, 2. Safe to run again.
-- Paste this whole part, from this line to the line that says END OF PART 1 OF 2.
--
-- Run these AFTER the 5 avatar parts (and avatars_fix1_upload_returning.sql if you used it).
-- Part 1: the check log, "accounts must be 24 hours old to upload", and what the review list shows.
-- Part 2: the two functions the check-avatar Edge Function uses (only the service role can call them).

do $$
begin
  if to_regprocedure('public.admin_approve_picture(text)') is null
     or to_regprocedure('public.request_avatar_upload()') is null
     or to_regclass('public.avatar_uploads') is null then
    raise exception 'Run the 5 avatar parts first (supabase/avatars/avatars_part1_of_5.sql ... part5), then these parts.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Log of every automatic check: who, which picture version, which service, what it said, what was decided.
-- It never stores the picture itself, and the service's raw answer is not stored, only a short reason.
-- ---------------------------------------------------------------------------
create table if not exists public.avatar_moderation_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  avatar_version bigint,
  mode text not null check (mode in ('upload', 'report')),
  provider text not null check (char_length(provider) <= 80),
  verdict text not null check (verdict in ('safe', 'flagged', 'uncertain', 'error')),
  reasons text check (reasons is null or char_length(reasons) <= 300),
  decision text not null check (decision in ('approved', 'rejected', 'held', 'kept', 'stale', 'manual')),
  created_at timestamptz not null default now()
);
create index if not exists avatar_moderation_log_picture_idx on public.avatar_moderation_log (user_id, avatar_version, created_at desc);
alter table public.avatar_moderation_log enable row level security;
revoke all on public.avatar_moderation_log from anon, authenticated;
-- No policies and no grants: only the service role (the Edge Function and you in the SQL Editor) can read or write it.

-- ---------------------------------------------------------------------------
-- Step 1 of an upload, now also refusing accounts younger than 24 hours. Everything else is unchanged:
-- banned players refused, 3 uploads per 24 hours, 10 seconds between tries, a 2 minute ticket, approved becomes pending.
-- ---------------------------------------------------------------------------
create or replace function public.request_avatar_upload() returns void
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  prof public.profiles;
begin
  if me is null then raise exception 'not_signed_in'; end if;
  perform pg_advisory_xact_lock(hashtextextended(me::text, 11));
  select * into prof from public.profiles where id = me;
  if prof.id is null then raise exception 'avatar_no_profile'; end if;
  if prof.banned then raise exception 'avatar_banned'; end if;
  if prof.created_at > now() - interval '24 hours' then raise exception 'avatar_account_new'; end if;
  if exists (select 1 from public.avatar_uploads where user_id = me and created_at > now() - interval '10 seconds') then
    raise exception 'avatar_rate';
  end if;
  if (select count(*) from public.avatar_uploads where user_id = me and created_at > now() - interval '24 hours') >= 3 then
    raise exception 'avatar_limit_day';
  end if;

  insert into public.avatar_uploads (user_id) values (me);
  insert into public.avatar_tickets (user_id, created_at, expires_at) values (me, now(), now() + interval '2 minutes')
  on conflict (user_id) do update set created_at = excluded.created_at, expires_at = excluded.expires_at;
  delete from public.avatar_purge_queue where path = me::text;

  if prof.avatar_status in ('approved', 'pending') and prof.avatar_uploaded_at is not null then
    update public.profiles set avatar_status = 'pending', avatar_flag = null where id = me;
  end if;
end
$$;
revoke execute on function public.request_avatar_upload() from public, anon;
grant execute on function public.request_avatar_upload() to authenticated;

-- ---------------------------------------------------------------------------
-- Your review list: the same as before, plus the last automatic check (so you can see why it was not decided).
-- ---------------------------------------------------------------------------
-- The last automatic check of a picture, as one line for the review list. Works before the check log exists (then null),
-- so the review list is the same whichever file was run last.
create or replace function public.avatar_last_check(p_user uuid, p_version bigint) returns text
language plpgsql stable security definer set search_path = public
as $$
declare r text;
begin
  if to_regclass('public.avatar_moderation_log') is null then return null; end if;
  execute $q$ select l.verdict || ' / ' || l.decision || coalesce(': ' || l.reasons, '')
                from public.avatar_moderation_log l
               where l.user_id = $1 and l.avatar_version is not distinct from $2
               order by l.id desc limit 1 $q$ into r using p_user, p_version;
  return r;
end
$$;
revoke execute on function public.avatar_last_check(uuid, bigint) from public, anon, authenticated;
grant execute on function public.avatar_last_check(uuid, bigint) to service_role;

create or replace view public.admin_pending_pictures as
  select p.username,
         p.avatar_status,
         coalesce(p.avatar_flag, 'new upload') as why,
         p.avatar_uploaded_at as uploaded_at,
         (select count(*) from public.avatar_reports r
           where r.target_id = p.id and r.created_at > coalesce(p.avatar_reviewed_at, '-infinity')) as reports,
         p.id::text as storage_path,
         p.banned,
         public.avatar_last_check(p.id, p.avatar_version) as last_check
    from public.profiles p
   where p.avatar_status = 'pending' and p.avatar_uploaded_at is not null
   order by p.avatar_uploaded_at;
revoke all on public.admin_pending_pictures from public, anon, authenticated;
grant select on public.admin_pending_pictures to service_role;

-- END OF PART 1 OF 2
