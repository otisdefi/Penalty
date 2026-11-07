-- Tiebreaker profiles and challenges: PART 3 OF 5. Run the parts in order 1, 2, 3, 4, 5. Safe to run again.
-- Paste this whole part, from this line to the line that says END OF PART 3 OF 5.

do $$
begin
  if to_regclass('public.challenges') is null or to_regclass('public.player_reports') is null then
    raise exception 'Part 2 has not been run yet. Run the parts in order: 1, 2, 3, 4, 5.';
  end if;
end $$;

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

-- END OF PART 3 OF 5
