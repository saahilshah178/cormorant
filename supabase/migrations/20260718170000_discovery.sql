-- Tier 4 discovery tables (PLAN.md §3).
-- `discovery_runs` tracks one background pipeline run (Workflow DevKit run id
-- included so the UI can reattach/stream/cancel after a page reload).
-- `discovery_instructions` is persistent free-text guidance the VC gives the
-- discovery agents; every active row is concatenated into the agent prompts on
-- every future run.

-- discovery_runs ---------------------------------------------------------
create table if not exists public.discovery_runs (
  id              uuid primary key default gen_random_uuid(),
  mode            text not null check (mode in ('batch', 'continuous')),
  target_count    integer,
  status          text not null default 'running' check (status in (
                    'running', 'stopped', 'completed', 'failed'
                  )),
  workflow_run_id text,
  thesis_id       uuid references public.theses(id) on delete set null,
  companies_found integer not null default 0,
  started_at      timestamptz not null default now(),
  stopped_at      timestamptz
);

create index if not exists discovery_runs_status_idx on public.discovery_runs(status);

-- discovery_instructions -------------------------------------------------
create table if not exists public.discovery_instructions (
  id         uuid primary key default gen_random_uuid(),
  text       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
