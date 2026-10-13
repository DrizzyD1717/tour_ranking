-- Run once in the Supabase SQL editor (existing project). New projects get this from schema.sql.
-- Knockout brackets: each match remembers which side of the next match its winner takes, and a
-- trigger moves winners on, refuses drawn results, and finishes the tournament after the final.

alter table public.matches
  add column if not exists next_slot text check (next_slot in ('home', 'away'));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'matches_next_pair') then
    alter table public.matches
      add constraint matches_next_pair check ((next_match_id is null) = (next_slot is null));
  end if;
end $$;

create or replace function public.touch_match() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  if (new.home_score, new.away_score, new.status) is distinct from (old.home_score, old.away_score, old.status) then
    new.entered_by = coalesce(auth.uid(), new.entered_by);
  end if;
  return new;
end $$;

-- ---------- knockout: winners move on by themselves -----------------------------
-- Runs after a match changes. It refuses a drawn knockout result, puts the winner into the next
-- round, takes them back out if the result is corrected or cleared, and finishes the tournament
-- when the final is played. It is security definer so a scorekeeper (who cannot edit the
-- tournament row) can still trigger these follow-on changes; it only ever touches the next match
-- and the tournament of the match that was just saved.
create or replace function public.advance_knockout() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  fmt text;
  old_winner uuid;
  new_winner uuid;
  target_status text;
begin
  select format into fmt from public.tournaments where id = new.tournament_id;
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

drop trigger if exists matches_advance on public.matches;
create trigger matches_advance
  after update on public.matches
  for each row execute function public.advance_knockout();
