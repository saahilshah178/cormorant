-- Tier 5 (2026-07-19 scope revision): One-click contact = a Gmail draft the VC
-- sends themselves. Re-shapes `outreach` from the Calendly-era columns to the
-- draft-tracking shape (PLAN.md §3) and adds `gmail_tokens`, the server-side
-- store for the signed-in VC's Google provider tokens (gmail.compose scope).

-- outreach: Calendly-era shape -> draft-tracking shape ----------------------
alter table public.outreach
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists founder_email text,
  add column if not exists gmail_draft_id text,
  add column if not exists drafted_at timestamptz;

alter table public.outreach drop column if exists scheduled_at;

-- Any pre-revision status values (contacted/responded/booked/needs_info)
-- would violate the new check; the table should be empty, but be safe.
update public.outreach set status = 'not_contacted'
  where status not in ('not_contacted', 'drafted');

alter table public.outreach drop constraint if exists outreach_status_check;
alter table public.outreach add constraint outreach_status_check
  check (status in ('not_contacted', 'drafted'));

-- One row per (company, user); the contact route upserts on this pair.
create unique index if not exists outreach_company_user_key
  on public.outreach (company_id, user_id);

-- Defense-in-depth, same posture as theses/companies: the service-role client
-- bypasses RLS; app-level user_id filters are the real enforcement.
alter table public.outreach enable row level security;

-- gmail_tokens: Google provider tokens captured at the OAuth callback -------
create table if not exists public.gmail_tokens (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  updated_at    timestamptz not null default now()
);

-- Deny-all RLS (no policies): only the service-role client may read tokens.
alter table public.gmail_tokens enable row level security;
