-- Cormorant initial schema (PLAN.md §3).
-- Every number a VC sees must trace back to rows in `signals` via
-- `scores.contributing_signal_ids`. No score without its signals.

-- theses -----------------------------------------------------------------
create table if not exists public.theses (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  stage             text,
  industries        text[] not null default '{}',
  min_traction      text,
  demographics_pref text,
  raw_thesis_text   text,
  created_at        timestamptz not null default now()
);

-- companies --------------------------------------------------------------
create table if not exists public.companies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  website    text,
  github_url text,
  sector     text,
  stage      text,
  source     text,
  indexed_at timestamptz not null default now()
);

-- signals ----------------------------------------------------------------
-- kind is constrained to the enumerated set from PLAN.md §3.
create table if not exists public.signals (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  kind         text not null check (kind in (
                 'commit_cadence', 'hire', 'funding', 'customer_mention',
                 'traction', 'press', 'other'
               )),
  value        text,
  source_url   text,
  confidence   real check (confidence >= 0 and confidence <= 1),
  extracted_at timestamptz not null default now()
);

create index if not exists signals_company_id_idx on public.signals(company_id);

-- scores -----------------------------------------------------------------
-- One score per (company, thesis). `contributing_signal_ids` links the score
-- back to the exact signals that produced it.
create table if not exists public.scores (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies(id) on delete cascade,
  thesis_id               uuid not null references public.theses(id) on delete cascade,
  fit_score               integer check (fit_score >= 0 and fit_score <= 100),
  confidence              real check (confidence >= 0 and confidence <= 1),
  fit_rationale           text,
  pass_reason             text,
  contributing_signal_ids uuid[] not null default '{}',
  scored_at               timestamptz not null default now(),
  unique (company_id, thesis_id)
);

create index if not exists scores_company_id_idx on public.scores(company_id);
create index if not exists scores_thesis_id_idx  on public.scores(thesis_id);

-- outreach (Tier 5 only) -------------------------------------------------
-- Defined here so the data model is complete; the outreach feature itself is
-- built in Tier 5 (and is the first thing cut if the core is behind).
create table if not exists public.outreach (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  status       text not null default 'not_contacted' check (status in (
                 'not_contacted', 'contacted', 'responded', 'booked', 'needs_info'
               )),
  scheduled_at timestamptz,
  notes        text
);

create index if not exists outreach_company_id_idx on public.outreach(company_id);
