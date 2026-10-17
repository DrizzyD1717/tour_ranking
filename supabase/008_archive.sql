-- Run once in the Supabase SQL editor (existing project, after 007). New projects get this from schema.sql.
-- Archiving: an archived tournament leaves the home list but keeps its page, its rankings and its record.
--   archive_mode 'auto'     : archived 24 hours after it finishes (the default)
--   archive_mode 'archived' : archived now, by the organizer
--   archive_mode 'pinned'   : never archived automatically, by the organizer
-- Nothing runs on a schedule: the app works out "archived" from archive_mode, status and finished_at.

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
