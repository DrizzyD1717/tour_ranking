-- Run once in the Supabase SQL editor (existing project, after 006). New projects get this from schema.sql.
-- The same account can't be entered twice in one tournament (it would count their results twice).
create unique index if not exists participants_one_entry_per_account
  on public.participants (tournament_id, user_id) where user_id is not null;
