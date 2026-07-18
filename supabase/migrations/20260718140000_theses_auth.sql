-- Adds per-user ownership to theses (Google sign-in via Supabase Auth).
-- Nullable: existing seed theses (created before auth existed) keep no
-- owner and simply stop matching any user's queries — harmless, and avoids
-- a backfill migration under a hackathon deadline.

alter table public.theses
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists theses_user_id_idx on public.theses(user_id);

alter table public.theses enable row level security;

-- Defense in depth: app code (service-role client) already filters every
-- query by user_id explicitly (lib/theses.ts). This policy is what would
-- protect the table if it were ever queried with the anon/public key
-- instead (the service role bypasses RLS entirely).
drop policy if exists "Theses are owned by their creator" on public.theses;
create policy "Theses are owned by their creator"
  on public.theses
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
