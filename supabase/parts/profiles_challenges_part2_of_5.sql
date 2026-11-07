-- Tiebreaker profiles and challenges: PART 2 OF 5. Run the parts in order 1, 2, 3, 4, 5. Safe to run again.
-- Paste this whole part, from this line to the line that says END OF PART 2 OF 5.

do $$
begin
  if to_regclass('public.player_blocks') is null or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'profile_hidden') then
    raise exception 'Part 1 has not been run yet. Run the parts in order: 1, 2, 3, 4, 5.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Challenges
--    mode 'friendly' = a wallet-free friend room (room_code is the room id, like tbk3m9x2qa)
--    mode 'online'   = a private two-wallet match (room_code is the join code, match_id is the match number)
--    The invite carries no private data: only who sent it and the room code.
-- ---------------------------------------------------------------------------
create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users (id) on delete cascade,
  receiver_id uuid not null references auth.users (id) on delete cascade,
  mode text not null check (mode in ('friendly', 'online')),
  room_code text not null check (room_code ~ '^(tb[a-z0-9]{8}|0x[0-9a-f]{64})$'),
  match_id numeric(20, 0) check (match_id is null or match_id between 1 and 999999999999999999),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired', 'busy', 'cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 minutes'),
  responded_at timestamptz,
  check (sender_id <> receiver_id),
  check ((mode = 'online') = (match_id is not null))
);
create index if not exists challenges_sender_idx on public.challenges (sender_id, created_at desc);
create index if not exists challenges_receiver_idx on public.challenges (receiver_id, created_at desc);
-- At most one pending challenge per sender, enforced by the database itself.
create unique index if not exists challenges_one_pending_per_sender on public.challenges (sender_id) where status = 'pending';

alter table public.challenges enable row level security;
revoke all on public.challenges from anon, authenticated;
grant select (id, sender_id, receiver_id, mode, room_code, match_id, status, created_at, expires_at, responded_at) on public.challenges to authenticated;
drop policy if exists "challenges: read mine" on public.challenges;
create policy "challenges: read mine" on public.challenges for select to authenticated
  using (sender_id = auth.uid() or receiver_id = auth.uid());
-- No insert, update or delete policy: everything goes through send_challenge() and respond_challenge().

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'challenges') then
    alter publication supabase_realtime add table public.challenges;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Reports on a player (the Report button on a profile card)
-- ---------------------------------------------------------------------------
create table if not exists public.player_reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references auth.users (id) on delete cascade,
  target_id uuid not null references auth.users (id) on delete cascade,
  reason text check (reason is null or char_length(reason) <= 100),
  created_at timestamptz not null default now(),
  unique (reporter_id, target_id),
  check (reporter_id <> target_id)
);
alter table public.player_reports enable row level security;
revoke all on public.player_reports from anon, authenticated;
-- No policies and no grants: players write through report_player(); you read the admin_player_reports view.

-- Five different players reporting someone hides their bio and name tag until you review it.
create or replace function public.player_reports_after_insert() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (select count(distinct reporter_id) from public.player_reports where target_id = new.target_id) >= 5 then
    update public.profiles set profile_hidden = true where id = new.target_id;
  end if;
  return null;
end
$$;
revoke execute on function public.player_reports_after_insert() from public, anon, authenticated;
drop trigger if exists player_reports_after_insert on public.player_reports;
create trigger player_reports_after_insert after insert on public.player_reports
  for each row execute function public.player_reports_after_insert();

-- END OF PART 2 OF 5
