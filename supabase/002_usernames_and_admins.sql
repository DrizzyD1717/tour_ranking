-- ============================================================================
-- Migration 002. Run once in the Supabase SQL editor on a database that already
-- ran the first schema.sql. (A brand new project can just run the updated schema.sql.)
--
--  1. Usernames. The first version built them from the email address, and profiles
--     are readable by everyone, so part of every email was public. Replace them.
--  2. Usernames must be 3 to 20 lowercase letters, numbers or underscores.
--  3. Tournament owners can add and remove scorekeepers, but cannot delete their
--     own owner row.
--  4. Send tournament changes (like "Finished") live to people watching.
-- ============================================================================

-- 1. New sign-ups get a neutral username
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, 'player_' || substr(replace(new.id::text, '-', ''), 1, 8));
  return new;
end $$;

-- Existing profiles still hold the email-based name (always ends in _ plus the first 4 characters of the id)
update public.profiles
   set username = 'player_' || substr(replace(id::text, '-', ''), 1, 8)
 where right(username, 5) = '_' || substr(id::text, 1, 4);

-- 2. Username rule (NOT VALID: applies to new and changed names, and never blocks this migration)
alter table public.profiles
  add constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,20}$') not valid;

-- 3. Owners manage scorekeepers only
drop policy if exists "admins owner manage" on public.tournament_admins;
create policy "admins owner add scorekeepers" on public.tournament_admins for insert
  with check (public.is_tournament_owner(tournament_id) and role = 'scorekeeper');
create policy "admins owner remove scorekeepers" on public.tournament_admins for delete
  using (public.is_tournament_owner(tournament_id) and role = 'scorekeeper');

-- 4. Live tournament status
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tournaments'
  ) then
    alter publication supabase_realtime add table public.tournaments;
  end if;
end $$;
