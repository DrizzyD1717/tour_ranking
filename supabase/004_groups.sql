-- Run once in the Supabase SQL editor (existing project). New projects get this from schema.sql.
-- Groups, then knockout: remember how many go through from each group, and lock group results
-- once the knockout stage has been drawn from them.

alter table public.tournaments
  add column if not exists advance_per_group smallint check (advance_per_group between 1 and 4);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tournaments_groups_need_advance') then
    alter table public.tournaments
      add constraint tournaments_groups_need_advance
      check (format <> 'groups_knockout' or advance_per_group is not null);
  end if;
end $$;

create or replace function public.advance_knockout() returns trigger
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
