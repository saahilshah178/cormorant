-- Per-user data isolation.
--
-- Before this migration companies/signals/discovery_instructions/discovery_runs
-- were global: any signed-in account saw (and could score/stop) another
-- account's discovered companies, discovery instructions, and runs. This scopes
-- them per-user while keeping the pre-indexed 43-company seed set shared:
--
--   companies.user_id IS NULL  -> shared demo pool, visible to everyone
--   companies.user_id = <uid>  -> private to that VC (discovered companies)
--
-- scores stay keyed by the per-user thesis_id (theses are already per-user), so
-- they partition correctly without a new column. signals inherit visibility
-- through their company_id.
--
-- As with theses, enforcement is app-level (the service-role client bypasses
-- RLS); the RLS policies below are defense in depth.

-- companies: nullable owner (NULL = shared seed set) --------------------------
alter table public.companies
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists companies_user_id_idx on public.companies(user_id);

-- discovery_instructions: per-user standing guidance --------------------------
alter table public.discovery_instructions
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists discovery_instructions_user_id_idx
  on public.discovery_instructions(user_id);

-- discovery_runs: per-user runs -----------------------------------------------
alter table public.discovery_runs
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists discovery_runs_user_id_idx
  on public.discovery_runs(user_id);

-- Cleanup: existing global rows would otherwise all become owner-less (NULL)
-- the instant the column is added — meaning every prior discovered company
-- would masquerade as part of the shared demo pool, and prior runs/instructions
-- would be orphaned. Remove those test artifacts so only the pristine
-- seed-dataset (source='seed-dataset') remains as the shared pool.
delete from public.companies where source like 'discovery:%';
delete from public.discovery_runs;
delete from public.discovery_instructions;

-- RLS (defense in depth; app filters by user_id explicitly) -------------------
alter table public.companies enable row level security;
drop policy if exists "Companies are shared or owned" on public.companies;
create policy "Companies are shared or owned"
  on public.companies
  for all
  using (user_id is null or auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.discovery_instructions enable row level security;
drop policy if exists "Discovery instructions are owned by their creator"
  on public.discovery_instructions;
create policy "Discovery instructions are owned by their creator"
  on public.discovery_instructions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.discovery_runs enable row level security;
drop policy if exists "Discovery runs are owned by their creator"
  on public.discovery_runs;
create policy "Discovery runs are owned by their creator"
  on public.discovery_runs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
