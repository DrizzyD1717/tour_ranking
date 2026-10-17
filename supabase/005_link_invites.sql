-- Run once in the Supabase SQL editor (existing project). New projects get this from schema.sql.
-- Linking an entrant to an account now needs that person's OK. The organizer's link starts as
-- 'pending'; the person accepts or declines. Only accepted links count in rankings and player pages.

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
