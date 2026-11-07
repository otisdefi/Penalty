-- Tiebreaker profiles and challenges: PART 5 OF 5. Run the parts in order 1, 2, 3, 4, 5. Safe to run again.
-- Paste this whole part, from this line to the line that says END OF PART 5 OF 5.

do $$
begin
  if to_regprocedure('public.send_challenge(text,text,text,numeric)') is null or to_regprocedure('public.my_challenges()') is null then
    raise exception 'Part 4 has not been run yet. Run the parts in order: 1, 2, 3, 4, 5.';
  end if;
end $$;

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
--   select cron.schedule('trim-challenges', '15 4 * * *', 'delete from public.challenges where created_at < now() - interval ''7 days''');

-- END OF PART 5 OF 5
