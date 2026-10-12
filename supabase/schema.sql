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
  status      text not null default 'draft' check (status in ('draft', 'live', 'finished')),
  visibility  text not null default 'public' check (visibility in ('public', 'unlisted', 'private')),
  starts_at   timestamptz,
  created_at  timestamptz not null default now()
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
  entered_by    uuid references public.profiles(id),
  updated_at    timestamptz not null default now(),
  check (home_id is null or away_id is null or home_id <> away_id),
  check (status <> 'finished' or (home_score is not null and away_score is not null))
);
create index on public.matches (tournament_id, round);

create function public.touch_match() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  new.entered_by = coalesce(auth.uid(), new.entered_by);
  return new;
end $$;

create trigger matches_touch
  before update on public.matches
  for each row execute function public.touch_match();

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
