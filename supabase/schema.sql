-- ============================================================================
-- Tournament platform schema (Supabase / Postgres)
-- Run in the Supabase SQL editor, or save as a migration.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- profiles (one per auth user) ------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text unique not null check (username ~ '^[a-z0-9_]{3,20}$'),
  avatar_url  text,
  created_at  timestamptz not null default now()
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Never derive this from the email address: profiles are readable by everyone.
  insert into public.profiles (id, username)
  values (new.id, 'player_' || substr(replace(new.id::text, '-', ''), 1, 8));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- organizations (department, faculty, friend group) ----------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique not null,
  type        text not null check (type in ('department', 'faculty', 'group', 'other')),
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

-- ---------- games (sport/game rules; seeded below) ---------------------------
create table public.games (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  name         text not null,
  category     text not null check (category in ('esports', 'sport')),
  score_label  text not null default 'Goals',   -- what a score means: Goals, Points, Sets, Kills
  allows_draws boolean not null default true,
  pts_win      int not null default 3,
  pts_draw     int not null default 1,
  pts_loss     int not null default 0
);

-- ---------- tournaments ------------------------------------------------------
create table public.tournaments (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  game_id     uuid not null references public.games(id),
  owner_id    uuid not null references public.profiles(id),
  org_id      uuid references public.organizations(id),
  format      text not null check (format in ('round_robin', 'knockout', 'groups_knockout')),
  double_round boolean not null default false,        -- home and away legs (round robin)
  advance_per_group smallint check (advance_per_group between 1 and 4),  -- groups_knockout: how many go through
  status      text not null default 'draft' check (status in ('draft', 'live', 'finished')),
  visibility  text not null default 'public' check (visibility in ('public', 'unlisted', 'private')),
  starts_at   timestamptz,
  created_at  timestamptz not null default now(),
  check (format <> 'groups_knockout' or advance_per_group is not null)
);
create index on public.tournaments (game_id);
create index on public.tournaments (org_id);
create index on public.tournaments (owner_id);

-- ---------- tournament admins (owner + scorekeepers) -------------------------
create table public.tournament_admins (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  role          text not null check (role in ('owner', 'scorekeeper')),
  primary key (tournament_id, user_id)
);

create function public.add_owner_as_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.tournament_admins (tournament_id, user_id, role)
  values (new.id, new.owner_id, 'owner');
  return new;
end $$;

create trigger on_tournament_created
  after insert on public.tournaments
  for each row execute function public.add_owner_as_admin();

-- ---------- participants (teams or single players) ---------------------------
create table public.participants (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name          text not null,
  user_id       uuid references public.profiles(id),   -- set when a participant is a real user
  org_id        uuid references public.organizations(id),
  seed          int,
  group_label   text,                                  -- 'A', 'B'... for groups_knockout
  unique (tournament_id, name)
);
create index on public.participants (tournament_id);

-- ---------- matches ----------------------------------------------------------
create table public.matches (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  round         int not null,
  group_label   text,
  home_id       uuid references public.participants(id) on delete cascade,  -- null = TBD (knockout)
  away_id       uuid references public.participants(id) on delete cascade,
  home_score    int check (home_score >= 0),
  away_score    int check (away_score >= 0),
  status        text not null default 'scheduled' check (status in ('scheduled', 'live', 'finished')),
  scheduled_at  timestamptz,
  next_match_id uuid references public.matches(id),    -- where the winner advances (knockout)
  next_slot     text check (next_slot in ('home', 'away')), -- which side of that match the winner takes
  entered_by    uuid references public.profiles(id),
  updated_at    timestamptz not null default now(),
  check (home_id is null or away_id is null or home_id <> away_id),
  check (status <> 'finished' or (home_score is not null and away_score is not null)),
  check ((next_match_id is null) = (next_slot is null))
);
create index on public.matches (tournament_id, round);

create function public.touch_match() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  -- Only a change to the result counts as "entered by"; moving a winner into the next round does not.
  if (new.home_score, new.away_score, new.status) is distinct from (old.home_score, old.away_score, old.status) then
    new.entered_by = coalesce(auth.uid(), new.entered_by);
  end if;
  return new;
end $$;

create trigger matches_touch
  before update on public.matches
  for each row execute function public.touch_match();

-- ---------- knockout: winners move on by themselves -----------------------------
-- Runs after a match changes. It refuses a drawn knockout result, puts the winner into the next
-- round, takes them back out if the result is corrected or cleared, and finishes the tournament
-- when the final is played. It is security definer so a scorekeeper (who cannot edit the
-- tournament row) can still trigger these follow-on changes; it only ever touches the next match
-- and the tournament of the match that was just saved.
create function public.advance_knockout() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  fmt text;
  old_winner uuid;
  new_winner uuid;
  target_status text;
begin
  select format into fmt from public.tournaments where id = new.tournament_id;

  -- Once the knockout stage exists it was seeded from the group tables, so those results are final.
  if fmt = 'groups_knockout' and new.group_label is not null
     and (new.home_score, new.away_score, new.status) is distinct from (old.home_score, old.away_score, old.status)
     and exists (select 1 from public.matches where tournament_id = new.tournament_id and group_label is null) then
    raise exception 'Group results are locked once the knockout stage has started.' using errcode = '23514';
  end if;

  if not (fmt = 'knockout' or (fmt = 'groups_knockout' and new.group_label is null)) then
    return new;
  end if;

  if new.status = 'finished' then
    if new.home_id is null or new.away_id is null then
      raise exception 'Both sides must be known before a result is saved.' using errcode = '23514';
    end if;
    if new.home_score = new.away_score then
      raise exception 'A knockout match cannot end level. Count extra time or penalties so one side is ahead.'
        using errcode = '23514';
    end if;
  end if;

  if old.status = 'finished' then
    old_winner := case when old.home_score > old.away_score then old.home_id else old.away_id end;
  end if;
  if new.status = 'finished' then
    new_winner := case when new.home_score > new.away_score then new.home_id else new.away_id end;
  end if;

  if new_winner is distinct from old_winner and new.next_match_id is not null then
    select status into target_status from public.matches where id = new.next_match_id;
    if target_status <> 'scheduled' then
      raise exception 'The next round has already started. Fix that result first.' using errcode = '23514';
    end if;
    if new.next_slot = 'home' then
      update public.matches set home_id = new_winner where id = new.next_match_id;
    else
      update public.matches set away_id = new_winner where id = new.next_match_id;
    end if;
  end if;

  -- The final decides the tournament.
  if new.next_match_id is null and new.status is distinct from old.status then
    if new.status = 'finished' then
      update public.tournaments set status = 'finished' where id = new.tournament_id and status = 'live';
    elsif old.status = 'finished' then
      update public.tournaments set status = 'live' where id = new.tournament_id and status = 'finished';
    end if;
  end if;

  return new;
end $$;

create trigger matches_advance
  after update on public.matches
  for each row execute function public.advance_knockout();

-- ============================================================================
-- Row Level Security
-- ============================================================================

create function public.is_tournament_admin(tid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tournament_admins
    where tournament_id = tid and user_id = auth.uid()
  );
$$;

create function public.is_tournament_owner(tid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tournament_admins
    where tournament_id = tid and user_id = auth.uid() and role = 'owner'
  );
$$;

create function public.tournament_readable(tid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tournaments t
    where t.id = tid
      and (t.visibility in ('public', 'unlisted') or public.is_tournament_admin(t.id))
  );
$$;

alter table public.profiles          enable row level security;
alter table public.organizations     enable row level security;
alter table public.games             enable row level security;
alter table public.tournaments       enable row level security;
alter table public.tournament_admins enable row level security;
alter table public.participants      enable row level security;
alter table public.matches           enable row level security;

-- profiles
create policy "profiles readable"   on public.profiles for select using (true);
create policy "profiles self update" on public.profiles for update using (auth.uid() = id);

-- games: public read, no client writes
create policy "games readable" on public.games for select using (true);

-- organizations
create policy "orgs readable"       on public.organizations for select using (true);
create policy "orgs create"         on public.organizations for insert with check (auth.uid() = created_by);
create policy "orgs creator update" on public.organizations for update using (auth.uid() = created_by);

-- tournaments (unlisted = readable by anyone who has the slug; the app only LISTS public ones)
create policy "tournaments read" on public.tournaments for select
  using (visibility in ('public', 'unlisted') or public.is_tournament_admin(id));
create policy "tournaments create" on public.tournaments for insert
  with check (auth.uid() = owner_id);
create policy "tournaments owner update" on public.tournaments for update
  using (public.is_tournament_owner(id));
create policy "tournaments owner delete" on public.tournaments for delete
  using (public.is_tournament_owner(id));

-- tournament_admins
create policy "admins read" on public.tournament_admins for select
  using (public.tournament_readable(tournament_id));
create policy "admins owner add scorekeepers" on public.tournament_admins for insert
  with check (public.is_tournament_owner(tournament_id) and role = 'scorekeeper');
create policy "admins owner remove scorekeepers" on public.tournament_admins for delete
  using (public.is_tournament_owner(tournament_id) and role = 'scorekeeper');

-- participants
create policy "participants read" on public.participants for select
  using (public.tournament_readable(tournament_id));
create policy "participants owner write" on public.participants for all
  using (public.is_tournament_owner(tournament_id))
  with check (public.is_tournament_owner(tournament_id));

-- matches: owner creates/deletes fixtures, owner + scorekeepers enter scores
create policy "matches read" on public.matches for select
  using (public.tournament_readable(tournament_id));
create policy "matches owner insert" on public.matches for insert
  with check (public.is_tournament_owner(tournament_id));
create policy "matches admin update" on public.matches for update
  using (public.is_tournament_admin(tournament_id))
  with check (public.is_tournament_admin(tournament_id));
create policy "matches owner delete" on public.matches for delete
  using (public.is_tournament_owner(tournament_id));

-- Realtime: broadcast match changes so standings update live
alter publication supabase_realtime add table public.matches;
alter publication supabase_realtime add table public.tournaments;

-- ============================================================================
-- Seed: games
-- ============================================================================
insert into public.games (slug, name, category, score_label, allows_draws, pts_win, pts_draw, pts_loss) values
  ('football',   'Football',   'sport',   'Goals',  true,  3, 1, 0),
  ('handball',   'Handball',   'sport',   'Goals',  true,  2, 1, 0),
  ('basketball', 'Basketball', 'sport',   'Points', false, 2, 0, 1),
  ('volleyball', 'Volleyball', 'sport',   'Sets',   false, 3, 0, 0),
  ('fifa',       'FIFA',       'esports', 'Goals',  true,  3, 1, 0),
  ('cod',        'Call of Duty', 'esports', 'Rounds', false, 3, 0, 0)
on conflict (slug) do nothing;

-- ============================================================================
-- Link invitations (same as supabase/005_link_invites.sql)
-- ============================================================================

alter table public.participants
  add column if not exists link_status text not null default 'none'
  check (link_status in ('none', 'pending', 'accepted', 'declined'));

-- Links made before this migration are kept as accepted.
update public.participants set link_status = 'accepted' where user_id is not null and link_status = 'none';

-- The status can't be chosen by the organizer: it is set here from who is linking whom, and the
-- only way to change it afterwards is respond_to_link() below (which raises a flag for this trigger).
create or replace function public.participants_link_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.user_id is distinct from old.user_id then
    new.link_status := case
      when new.user_id is null then 'none'
      when new.user_id = auth.uid() then 'accepted'   -- linking yourself needs no invitation
      else 'pending'
    end;
  elsif new.link_status is distinct from old.link_status
        and coalesce(current_setting('matchday.link_response', true), '') <> '1' then
    new.link_status := old.link_status;
  end if;
  return new;
end $$;

drop trigger if exists participants_link_status on public.participants;
create trigger participants_link_status
  before insert or update on public.participants
  for each row execute function public.participants_link_status();

-- The linked person answers their own invitation. Only a pending one can be answered, and only by them.
create or replace function public.respond_to_link(pid uuid, accept boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare changed int;
begin
  perform set_config('matchday.link_response', '1', true);
  update public.participants
     set link_status = case when accept then 'accepted' else 'declined' end
   where id = pid and user_id = auth.uid() and link_status = 'pending';
  get diagnostics changed = row_count;
  perform set_config('matchday.link_response', '', true);
  return changed = 1;
end $$;

-- The signed-in person's open invitations. A function (not a table read) so invitations to private
-- tournaments show up too: the person was invited, but isn't otherwise allowed to read that tournament.
create or replace function public.my_link_invites()
returns table (participant_id uuid, entrant_name text, tournament_name text, tournament_slug text, visibility text, organizer text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, t.name, t.slug, t.visibility, o.username
    from public.participants p
    join public.tournaments t on t.id = p.tournament_id
    left join public.profiles o on o.id = t.owner_id
   where p.user_id = auth.uid() and p.link_status = 'pending'
   order by t.created_at desc;
$$;

revoke all on function public.respond_to_link(uuid, boolean) from public;
revoke all on function public.my_link_invites() from public;
grant execute on function public.respond_to_link(uuid, boolean) to authenticated;
grant execute on function public.my_link_invites() to authenticated;

-- ============================================================================
-- Unlink me (same as supabase/006_unlink_me.sql)
-- ============================================================================

create or replace function public.unlink_me(pid uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare changed int;
begin
  perform set_config('matchday.link_response', '1', true);
  update public.participants
     set link_status = 'declined'
   where id = pid and user_id = auth.uid() and link_status = 'accepted';
  get diagnostics changed = row_count;
  perform set_config('matchday.link_response', '', true);
  return changed = 1;
end $$;

-- Tournaments the signed-in person is currently linked to (accepted links), including private ones.
create or replace function public.my_links()
returns table (participant_id uuid, entrant_name text, tournament_name text, tournament_slug text, visibility text, organizer text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, t.name, t.slug, t.visibility, o.username
    from public.participants p
    join public.tournaments t on t.id = p.tournament_id
    left join public.profiles o on o.id = t.owner_id
   where p.user_id = auth.uid() and p.link_status = 'accepted'
   order by t.created_at desc;
$$;

revoke all on function public.unlink_me(uuid) from public;
revoke all on function public.my_links() from public;
grant execute on function public.unlink_me(uuid) to authenticated;
grant execute on function public.my_links() to authenticated;

-- ============================================================================
-- One entry per account (same as supabase/007_one_entry_per_account.sql)
-- ============================================================================
create unique index if not exists participants_one_entry_per_account
  on public.participants (tournament_id, user_id) where user_id is not null;

-- ============================================================================
-- Archive (same as supabase/008_archive.sql)
-- Archived tournaments leave the home list but keep their page and rankings. archive_mode:
--   'auto' archives 24 hours after finishing, 'archived' archives now, 'pinned' never auto-archives.
-- ============================================================================
alter table public.tournaments
  add column if not exists archive_mode text not null default 'auto'
  check (archive_mode in ('auto', 'archived', 'pinned'));
alter table public.tournaments add column if not exists finished_at timestamptz;

-- Tournaments already finished get a fresh 24 hours before they auto-archive.
update public.tournaments set finished_at = now() where status = 'finished' and finished_at is null;

-- finished_at is always worked out here, never taken from the client: set when the tournament
-- finishes, cleared if it is reopened, untouched otherwise.
create or replace function public.tournaments_finished_at() returns trigger
language plpgsql as $$
begin
  if new.status <> 'finished' then
    new.finished_at := null;
  elsif tg_op = 'INSERT' or old.status is distinct from 'finished' then
    new.finished_at := now();
  else
    new.finished_at := old.finished_at;
  end if;
  return new;
end $$;

drop trigger if exists tournaments_finished_at on public.tournaments;
create trigger tournaments_finished_at
  before insert or update on public.tournaments
  for each row execute function public.tournaments_finished_at();
