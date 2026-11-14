-- Run once in the Supabase SQL editor (existing project, after 008). New projects get this from schema.sql.
-- Lets open tournament pages hear about entrant changes (renames, links, accepted invitations) live.
-- Matches and tournaments were already broadcast; row-level security still decides who receives what.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'participants'
  ) then
    alter publication supabase_realtime add table public.participants;
  end if;
end $$;
