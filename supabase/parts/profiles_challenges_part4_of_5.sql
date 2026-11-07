-- Tiebreaker profiles and challenges: PART 4 OF 5. Run the parts in order 1, 2, 3, 4, 5. Safe to run again.
-- Paste this whole part, from this line to the line that says END OF PART 4 OF 5.

do $$
begin
  if to_regprocedure('public.get_public_profile(text)') is null or to_regprocedure('public.touch_presence()') is null then
    raise exception 'Part 3 has not been run yet. Run the parts in order: 1, 2, 3, 4, 5.';
  end if;
end $$;

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

-- END OF PART 4 OF 5
