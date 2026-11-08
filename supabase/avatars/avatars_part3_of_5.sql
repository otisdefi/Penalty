-- Tiebreaker profile pictures: PART 3 OF 5. Run the parts in order 1, 2, 3, 4, 5. Safe to run again.
-- Paste this whole part, from this line to the line that says END OF PART 3 OF 5.
-- Part 3: what a player can do: ask to upload, confirm the upload, remove their picture.

do $$
begin
  if to_regprocedure('public.can_upload_avatar(text)') is null or to_regprocedure('public.can_read_avatar(text)') is null then
    raise exception 'Part 2 has not been run yet. Run the parts in order: 1, 2, 3, 4, 5.';
  end if;
end $$;

-- Step 1 of an upload. Refuses banned players and a 4th upload in 24 hours, then hands out a 2 minute ticket.
-- An approved picture becomes pending here, so a new file can never be public before you have looked at it.
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
  if exists (select 1 from public.avatar_uploads where user_id = me and created_at > now() - interval '10 seconds') then
    raise exception 'avatar_rate';
  end if;
  if (select count(*) from public.avatar_uploads where user_id = me and created_at > now() - interval '24 hours') >= 3 then
    raise exception 'avatar_limit_day';
  end if;

  insert into public.avatar_uploads (user_id) values (me);
  insert into public.avatar_tickets (user_id, created_at, expires_at) values (me, now(), now() + interval '2 minutes')
  on conflict (user_id) do update set created_at = excluded.created_at, expires_at = excluded.expires_at;
  delete from public.avatar_purge_queue where path = me::text; -- the new file replaces the old one, do not delete it later

  if prof.avatar_status in ('approved', 'pending') and prof.avatar_uploaded_at is not null then
    update public.profiles set avatar_status = 'pending', avatar_flag = null where id = me;
  end if;
end
$$;
revoke execute on function public.request_avatar_upload() from public, anon;
grant execute on function public.request_avatar_upload() to authenticated;

-- Step 3 of an upload (step 2 is the file upload itself). Checks the file really arrived, then marks it pending.
create or replace function public.confirm_avatar_uploaded() returns void
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  t public.avatar_tickets;
begin
  if me is null then raise exception 'not_signed_in'; end if;
  select * into t from public.avatar_tickets where user_id = me;
  if t.user_id is null or t.expires_at < now() - interval '3 minutes' then raise exception 'avatar_no_ticket'; end if;
  if not exists (select 1 from storage.objects o
                  where o.bucket_id = 'avatars' and o.name = me::text
                    and greatest(coalesce(o.updated_at, o.created_at), o.created_at) >= t.created_at) then
    raise exception 'avatar_not_found';
  end if;
  update public.profiles
     set avatar_status = 'pending', avatar_flag = null,
         avatar_uploaded_at = now(), avatar_version = (extract(epoch from clock_timestamp()) * 1000)::bigint
   where id = me and not banned;
  if not found then raise exception 'avatar_banned'; end if;
  delete from public.avatar_tickets where user_id = me;
end
$$;
revoke execute on function public.confirm_avatar_uploaded() from public, anon;
grant execute on function public.confirm_avatar_uploaded() to authenticated;

-- "Remove my picture". The player gets the default avatar straight away; the file is deleted from storage
-- by the app (own-file delete policy) and, as a safety net, by the purge-avatars Edge Function.
create or replace function public.remove_my_avatar() returns void
language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not_signed_in'; end if;
  update public.profiles
     set avatar_status = 'none', avatar_version = null, avatar_uploaded_at = null, avatar_flag = null
   where id = me;
  delete from public.avatar_tickets where user_id = me;
  insert into public.avatar_purge_queue (path) values (me::text) on conflict (path) do update set queued_at = now();
end
$$;
revoke execute on function public.remove_my_avatar() from public, anon;
grant execute on function public.remove_my_avatar() to authenticated;

-- END OF PART 3 OF 5
