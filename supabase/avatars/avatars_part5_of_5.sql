-- Tiebreaker profile pictures: PART 5 OF 5. Run the parts in order 1, 2, 3, 4, 5. Safe to run again.
-- Paste this whole part, from this line to the line that says END OF PART 5 OF 5.
-- Part 5: your review tools (SQL Editor, as the project owner) and the clean-up of deleted files.

do $$
begin
  if to_regprocedure('public.get_avatar_info(text[])') is null or to_regprocedure('public.report_avatar(text)') is null then
    raise exception 'Part 4 has not been run yet. Run the parts in order: 1, 2, 3, 4, 5.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Review tools. Players cannot call these; only the service role (the SQL Editor) can.
--   select * from public.admin_pending_pictures;            -- who is waiting, and why
--   select public.admin_approve_picture('somename');         -- shown to everyone
--   select public.admin_reject_picture('somename');          -- hidden and deleted from storage
--   select public.admin_remove_picture('somename');          -- same, and back to the default avatar
-- To look at a picture: Storage > avatars > the file named like storage_path in the view.
-- ---------------------------------------------------------------------------
create or replace view public.admin_pending_pictures as
  select p.username,
         p.avatar_status,
         coalesce(p.avatar_flag, 'new upload') as why,
         p.avatar_uploaded_at as uploaded_at,
         (select count(*) from public.avatar_reports r
           where r.target_id = p.id and r.created_at > coalesce(p.avatar_reviewed_at, '-infinity')) as reports,
         p.id::text as storage_path,
         p.banned
    from public.profiles p
   where p.avatar_status = 'pending' and p.avatar_uploaded_at is not null
   order by p.avatar_uploaded_at;
revoke all on public.admin_pending_pictures from public, anon, authenticated;
grant select on public.admin_pending_pictures to service_role;

create or replace function public.admin_approve_picture(p_username text) returns void
language plpgsql security definer set search_path = public
as $$
declare prof public.profiles;
begin
  select * into prof from public.profiles where username_lower = lower(coalesce(p_username, '')) for update;
  if prof.id is null then raise exception 'unknown_user'; end if;
  if prof.avatar_status <> 'pending' or prof.avatar_uploaded_at is null then raise exception 'no_pending_picture'; end if;
  if exists (select 1 from public.avatar_tickets where user_id = prof.id and expires_at > now()) then
    raise exception 'upload_in_progress_try_again_in_2_minutes';
  end if;
  update public.profiles set avatar_status = 'approved', avatar_reviewed_at = now(), avatar_flag = null where id = prof.id;
  delete from public.avatar_tickets where user_id = prof.id;
end
$$;

-- Used by reject and remove: the player falls back to the default avatar and the file is queued for deletion.
create or replace function public.admin_drop_picture(p_username text, p_status text) returns void
language plpgsql security definer set search_path = public
as $$
declare uid uuid;
begin
  select id into uid from public.profiles where username_lower = lower(coalesce(p_username, ''));
  if uid is null then raise exception 'unknown_user'; end if;
  update public.profiles
     set avatar_status = p_status, avatar_version = null, avatar_uploaded_at = null, avatar_flag = null, avatar_reviewed_at = now()
   where id = uid;
  delete from public.avatar_tickets where user_id = uid;
  insert into public.avatar_purge_queue (path) values (uid::text) on conflict (path) do update set queued_at = now();
end
$$;

create or replace function public.admin_reject_picture(p_username text) returns void
language sql security definer set search_path = public
as $$ select public.admin_drop_picture(p_username, 'rejected') $$;

create or replace function public.admin_remove_picture(p_username text) returns void
language sql security definer set search_path = public
as $$ select public.admin_drop_picture(p_username, 'none') $$;

-- ---------------------------------------------------------------------------
-- Deleting files. Supabase does not allow deleting storage files with SQL, so queued files are deleted through the
-- Storage API by the purge-avatars Edge Function (supabase/functions/purge-avatars). It only takes files whose owner
-- is back to "none" or "rejected", or whose account no longer exists, and never one that was uploaded again.
-- ---------------------------------------------------------------------------
create or replace function public.take_avatar_purge_batch() returns text[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(q.path), array[]::text[])
    from (
      select pq.path from public.avatar_purge_queue pq
       where not exists (select 1 from public.profiles p where p.id::text = pq.path and p.avatar_status not in ('none', 'rejected'))
       order by pq.queued_at limit 50
    ) q
$$;

create or replace function public.done_avatar_purge(p_paths text[]) returns void
language sql security definer set search_path = public
as $$ delete from public.avatar_purge_queue where path = any (coalesce(p_paths, array[]::text[])) $$;

-- When an account is deleted, its picture is queued for deletion too.
create or replace function public.profiles_avatar_cleanup() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.avatar_uploaded_at is not null then
    insert into public.avatar_purge_queue (path) values (old.id::text) on conflict (path) do update set queued_at = now();
  end if;
  return null;
end
$$;
revoke execute on function public.profiles_avatar_cleanup() from public, anon, authenticated;
drop trigger if exists profiles_avatar_cleanup on public.profiles;
create trigger profiles_avatar_cleanup after delete on public.profiles
  for each row execute function public.profiles_avatar_cleanup();

revoke execute on function public.admin_approve_picture(text) from public, anon, authenticated;
revoke execute on function public.admin_drop_picture(text, text) from public, anon, authenticated;
revoke execute on function public.admin_reject_picture(text) from public, anon, authenticated;
revoke execute on function public.admin_remove_picture(text) from public, anon, authenticated;
revoke execute on function public.take_avatar_purge_batch() from public, anon, authenticated;
revoke execute on function public.done_avatar_purge(text[]) from public, anon, authenticated;
grant execute on function public.admin_approve_picture(text), public.admin_drop_picture(text, text),
  public.admin_reject_picture(text), public.admin_remove_picture(text),
  public.take_avatar_purge_batch(), public.done_avatar_purge(text[]) to service_role;

-- END OF PART 5 OF 5
