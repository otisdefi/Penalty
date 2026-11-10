-- Tiebreaker profile pictures: FIX 1. Safe to run again. Run it once if you already ran the 5 parts before this fix.
-- Paste this whole file, from this line to the line that says END OF FIX 1.
--
-- Problem: the first upload failed with "new row violates row-level security policy" (shown by Supabase Storage as HTTP 400).
-- Storage reads the new file row back right after writing it, and the read rule only allowed a picture that was already
-- pending or approved. Now the owner may also read their own file while an upload ticket is open.

do $$
begin
  if to_regprocedure('public.can_read_avatar(text)') is null or to_regclass('public.avatar_tickets') is null then
    raise exception 'Run the 5 avatar parts first (parts 1 and 2 at least), then this fix.';
  end if;
end $$;

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
    -- Own file: while pending or approved, and also while an upload ticket is open. Storage reads the new row back
    -- right after writing it (INSERT ... RETURNING), so the first upload would be refused without the ticket clause.
    return exists (
      select 1 from public.profiles p
       where p.id = me and not p.banned
         and (p.avatar_status in ('pending', 'approved')
              or exists (select 1 from public.avatar_tickets t where t.user_id = me and t.expires_at > now()))
    );
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

-- END OF FIX 1
