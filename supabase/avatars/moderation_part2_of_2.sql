-- Tiebreaker automatic picture checks: PART 2 OF 2. Run the parts in order 1, 2. Safe to run again.
-- Paste this whole part, from this line to the line that says END OF PART 2 OF 2.
-- Part 2: the functions behind the check-avatar Edge Function. Only the service role can call them, so a player can
-- never approve, reject or hold a picture, not even their own. Players still only reach the 3 player functions.

do $$
begin
  if to_regclass('public.avatar_moderation_log') is null then
    raise exception 'Part 1 has not been run yet. Run the parts in order: 1, 2.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Before a check: may this picture be checked now? Returns 'check' and the picture version to check, or a reason.
--   mode 'upload': the owner's new picture (pending, not reported, no upload in progress)
--   mode 'report': an approved picture that this reporter has reported (one re-check per 10 minutes)
-- At most 3 checks per picture version, so nobody can run up the bill of the checking service.
-- ---------------------------------------------------------------------------
create or replace function public.moderation_claim(p_user uuid, p_mode text default 'upload', p_reporter uuid default null)
returns table (outcome text, picture_version bigint)
language plpgsql security definer set search_path = public
as $$
declare prof public.profiles;
begin
  if p_mode not in ('upload', 'report') then raise exception 'moderation_bad_mode'; end if;
  select * into prof from public.profiles where id = p_user for update;
  if prof.id is null or prof.avatar_uploaded_at is null or prof.avatar_version is null then
    return query select 'no_picture'::text, null::bigint; return;
  end if;
  if prof.banned then return query select 'banned'::text, null::bigint; return; end if;
  if exists (select 1 from public.avatar_tickets t where t.user_id = p_user and t.expires_at > now()) then
    return query select 'busy'::text, null::bigint; return; -- an upload is still in progress
  end if;

  if p_mode = 'upload' then
    if prof.avatar_status <> 'pending' then return query select 'not_pending'::text, null::bigint; return; end if;
    if prof.avatar_flag is not null then return query select 'manual'::text, null::bigint; return; end if; -- reported: a person decides
  else
    if prof.avatar_status <> 'approved' then return query select 'not_pending'::text, null::bigint; return; end if;
    if p_reporter is null or not exists (
         select 1 from public.avatar_reports r
          where r.reporter_id = p_reporter and r.target_id = p_user and r.avatar_version is not distinct from prof.avatar_version) then
      return query select 'not_reported'::text, null::bigint; return;
    end if;
    if exists (select 1 from public.avatar_moderation_log l
                where l.user_id = p_user and l.avatar_version is not distinct from prof.avatar_version
                  and l.mode = 'report' and l.created_at > now() - interval '10 minutes') then
      return query select 'recent'::text, null::bigint; return;
    end if;
  end if;

  if (select count(*) from public.avatar_moderation_log l
       where l.user_id = p_user and l.avatar_version is not distinct from prof.avatar_version and l.mode = p_mode) >= 3 then
    return query select 'too_many'::text, null::bigint; return;
  end if;
  return query select 'check'::text, prof.avatar_version;
end
$$;

-- ---------------------------------------------------------------------------
-- After a check: apply the verdict. Returns what happened:
--   approved  the new picture is public            rejected  the picture is gone, the file is queued for deletion
--   held      an approved picture was hidden again for your review (uncertain after a report)
--   kept      nothing changes (uncertain or error on a new picture stays pending; safe after a report stays approved)
--   manual    safe, but the picture was reported, so a person must decide      stale  the picture changed meanwhile
-- ---------------------------------------------------------------------------
create or replace function public.moderation_decide(
  p_user uuid, p_version bigint, p_mode text, p_provider text, p_verdict text, p_reasons text default null
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  prof public.profiles;
  decision text;
begin
  if p_mode not in ('upload', 'report') then raise exception 'moderation_bad_mode'; end if;
  if p_verdict not in ('safe', 'flagged', 'uncertain', 'error') then raise exception 'moderation_bad_verdict'; end if;
  select * into prof from public.profiles where id = p_user for update;
  if prof.id is null then return 'stale'; end if;

  if prof.avatar_version is distinct from p_version or prof.avatar_uploaded_at is null
     or exists (select 1 from public.avatar_tickets t where t.user_id = p_user and t.expires_at > now()) then
    decision := 'stale'; -- a newer upload replaced the picture that was checked
  elsif prof.banned then
    decision := 'kept';
  elsif p_mode = 'upload' then
    if prof.avatar_status <> 'pending' then decision := 'stale';
    elsif p_verdict = 'flagged' then decision := 'rejected';
    elsif p_verdict = 'safe' then decision := case when prof.avatar_flag is not null then 'manual' else 'approved' end;
    else decision := 'kept';
    end if;
  else
    if prof.avatar_status <> 'approved' then decision := 'stale';
    elsif p_verdict = 'flagged' then decision := 'rejected';
    elsif p_verdict = 'uncertain' then decision := 'held';
    else decision := 'kept'; -- safe, or the service was down: a single report must not hide a picture
    end if;
  end if;

  if decision = 'approved' then
    update public.profiles set avatar_status = 'approved', avatar_reviewed_at = now(), avatar_flag = null where id = p_user;
  elsif decision = 'rejected' then
    update public.profiles
       set avatar_status = 'rejected', avatar_version = null, avatar_uploaded_at = null, avatar_flag = null, avatar_reviewed_at = now()
     where id = p_user;
    delete from public.avatar_tickets where user_id = p_user;
    insert into public.avatar_purge_queue (path) values (p_user::text) on conflict (path) do update set queued_at = now();
  elsif decision = 'held' then
    update public.profiles set avatar_status = 'pending', avatar_flag = 'reported' where id = p_user;
  end if;

  insert into public.avatar_moderation_log (user_id, avatar_version, mode, provider, verdict, reasons, decision)
  values (p_user, p_version, p_mode, left(coalesce(nullif(p_provider, ''), 'unknown'), 80), p_verdict, left(p_reasons, 300), decision);
  return decision;
end
$$;

revoke execute on function public.moderation_claim(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.moderation_decide(uuid, bigint, text, text, text, text) from public, anon, authenticated;
grant execute on function public.moderation_claim(uuid, text, uuid), public.moderation_decide(uuid, bigint, text, text, text, text) to service_role;

-- END OF PART 2 OF 2
