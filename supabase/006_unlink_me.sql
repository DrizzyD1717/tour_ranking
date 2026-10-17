-- Run once in the Supabase SQL editor (existing project, after 005). New projects get this from schema.sql.
-- A player can remove a link they accepted. The entrant stays in the tournament as a plain name,
-- and the organizer can't re-invite the same account by accident: the status becomes 'declined'.

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
