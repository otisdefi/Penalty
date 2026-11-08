-- Tiebreaker profile pictures: PART 4 OF 5. Run the parts in order 1, 2, 3, 4, 5. Safe to run again.
-- Paste this whole part, from this line to the line that says END OF PART 4 OF 5.
-- Part 4: what the app asks to draw an avatar, "Report picture", and the auto-hide after 3 reports.

do $$
begin
  if to_regprocedure('public.request_avatar_upload()') is null or to_regprocedure('public.remove_my_avatar()') is null then
    raise exception 'Part 3 has not been run yet. Run the parts in order: 1, 2, 3, 4, 5.';
  end if;
end $$;

-- For up to 100 usernames: the jersey colours and number (for the generated default avatar), and the picture
-- only when this reader may see it. avatar_path is the object name; the app turns it into a short-lived signed link.
-- Returns no email, no wallet address and nothing about pictures that are pending, rejected, removed or hidden.
create or replace function public.get_avatar_info(p_usernames text[])
returns table (
  username text, jersey_color text, jersey_secondary text, jersey_pattern text, jersey_number int,
  avatar_status text, avatar_path text, avatar_version bigint
)
language plpgsql stable security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  reader_banned boolean;
begin
  if me is null then raise exception 'not_signed_in'; end if;
  reader_banned := exists (select 1 from public.profiles r where r.id = me and r.banned);
  return query
    with wanted as (
      select distinct lower(x) as name from unnest((coalesce(p_usernames, array[]::text[]))[1:100]) as x
    ), seen as (
      select p.*,
             (not reader_banned and not p.banned and p.avatar_status = 'approved'
              and not exists (select 1 from public.player_blocks b where b.blocker_id = p.id and b.blocked_id = me and b.kind = 'block')) as visible
        from public.profiles p join wanted w on w.name = p.username_lower
    )
    select s.username,
           case when s.banned then '#e5383b' else s.jersey_color end,
           case when s.banned then '#f1f5f9' else s.jersey_secondary end,
           case when s.banned then 'solid' else s.jersey_pattern end,
           (case when s.banned then 10 else s.jersey_number end)::int,
           case when s.id = me and not reader_banned and not s.banned then s.avatar_status when s.visible then 'approved' else 'none' end,
           case when (s.id = me and not reader_banned and not s.banned and s.avatar_status in ('pending', 'approved')) or s.visible then s.id::text end,
           case when (s.id = me and not reader_banned and not s.banned and s.avatar_status in ('pending', 'approved')) or s.visible then s.avatar_version end
      from seen s;
end
$$;
revoke execute on function public.get_avatar_info(text[]) from public, anon;
grant execute on function public.get_avatar_info(text[]) to authenticated;

-- "Report picture" on a profile card. Only an approved picture can be reported; 5 reports an hour per player.
create or replace function public.report_avatar(p_username text) returns void
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  target public.profiles;
begin
  if me is null then raise exception 'not_signed_in'; end if;
  select * into target from public.profiles where username_lower = lower(coalesce(p_username, ''));
  if target.id is null then raise exception 'avatar_unknown_player'; end if;
  if target.id = me then raise exception 'avatar_report_self'; end if;
  if target.banned or target.avatar_status <> 'approved' then raise exception 'avatar_report_unavailable'; end if;
  if (select count(*) from public.avatar_reports where reporter_id = me and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'avatar_report_rate';
  end if;
  insert into public.avatar_reports (reporter_id, target_id, avatar_version) values (me, target.id, target.avatar_version)
  on conflict (reporter_id, target_id, coalesce(avatar_version, 0)) do nothing;
end
$$;
revoke execute on function public.report_avatar(text) from public, anon;
grant execute on function public.report_avatar(text) to authenticated;

-- 3 different players reporting the same picture hide it (back to "pending") until you review it.
-- Reports made before your last review do not count again.
create or replace function public.avatar_reports_after_insert() returns trigger
language plpgsql security definer set search_path = public
as $$
declare reviewed timestamptz;
begin
  select coalesce(avatar_reviewed_at, '-infinity') into reviewed from public.profiles where id = new.target_id;
  if (select count(distinct r.reporter_id) from public.avatar_reports r
       where r.target_id = new.target_id
         and r.avatar_version is not distinct from new.avatar_version
         and r.created_at > reviewed) >= 3 then
    update public.profiles set avatar_status = 'pending', avatar_flag = 'reported'
     where id = new.target_id and avatar_status = 'approved';
  end if;
  return null;
end
$$;
revoke execute on function public.avatar_reports_after_insert() from public, anon, authenticated;
drop trigger if exists avatar_reports_after_insert on public.avatar_reports;
create trigger avatar_reports_after_insert after insert on public.avatar_reports
  for each row execute function public.avatar_reports_after_insert();

-- END OF PART 4 OF 5
