-- Tiebreaker profile pictures: PART 2 OF 5. Run the parts in order 1, 2, 3, 4, 5. Safe to run again.
-- Paste this whole part, from this line to the line that says END OF PART 2 OF 5.
-- Part 2: the storage rules (who may upload, who may read) for the "avatars" bucket.

do $$
begin
  if to_regclass('public.avatar_tickets') is null or to_regclass('public.avatar_purge_queue') is null
     or not exists (select 1 from storage.buckets where id = 'avatars') then
    raise exception 'Part 1 has not been run yet. Run the parts in order: 1, 2, 3, 4, 5.';
  end if;
end $$;

-- May the signed-in player write this object name? Only their own id as the name, only with a valid ticket
-- (request_avatar_upload() gives one for 2 minutes and refuses banned players and a 4th upload in a day).
create or replace function public.can_upload_avatar(p_name text) returns boolean
language sql stable security definer set search_path = public
as $$
  select auth.uid() is not null
     and p_name = auth.uid()::text
     and exists (select 1 from public.profiles p where p.id = auth.uid() and not p.banned)
     and exists (select 1 from public.avatar_tickets t where t.user_id = auth.uid() and t.expires_at > now())
$$;
revoke execute on function public.can_upload_avatar(text) from public, anon;
grant execute on function public.can_upload_avatar(text) to authenticated;

-- May the signed-in player read this object? (Banned players read nothing.)
--   * their own picture while it is pending or approved
--   * somebody else's picture only when it is approved, the owner is not banned, and the owner has not blocked them
create or replace function public.can_read_avatar(p_name text) returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  owner_id uuid;
begin
  if me is null or p_name is null
     or p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  owner_id := p_name::uuid;
  if exists (select 1 from public.profiles r where r.id = me and r.banned) then return false; end if;
  if owner_id = me then
    return exists (select 1 from public.profiles p where p.id = me and not p.banned and p.avatar_status in ('pending', 'approved'));
  end if;
  return exists (
    select 1 from public.profiles p
     where p.id = owner_id and not p.banned and p.avatar_status = 'approved'
       and not exists (select 1 from public.player_blocks b where b.blocker_id = owner_id and b.blocked_id = me and b.kind = 'block')
  );
end
$$;
revoke execute on function public.can_read_avatar(text) from public, anon;
grant execute on function public.can_read_avatar(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Policies on storage.objects (only for the avatars bucket). Guests (anon) get nothing.
-- ---------------------------------------------------------------------------
drop policy if exists "avatars: upload own" on storage.objects;
create policy "avatars: upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and public.can_upload_avatar(name));

drop policy if exists "avatars: replace own" on storage.objects;
create policy "avatars: replace own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and name = auth.uid()::text)
  with check (bucket_id = 'avatars' and public.can_upload_avatar(name));

drop policy if exists "avatars: read allowed" on storage.objects;
create policy "avatars: read allowed" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and public.can_read_avatar(name));

drop policy if exists "avatars: delete own" on storage.objects;
create policy "avatars: delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and name = auth.uid()::text);

-- END OF PART 2 OF 5
