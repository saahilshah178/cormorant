-- Thesis stage becomes multi-select (PLAN.md 1.1): a VC often invests across
-- more than one stage (e.g. pre-seed AND seed), so a thesis targets a SET of
-- stages rather than a single one.
--
-- `theses.stage text` -> `theses.stages text[]`. Existing rows are backfilled
-- from their old single value so no thesis loses its stage. Company stage
-- (companies.stage) is unchanged — a company still has exactly one stage.

alter table public.theses
  add column if not exists stages text[] not null default '{}';

-- Backfill: preserve each thesis's existing single stage as a one-element set.
update public.theses
  set stages = array[stage]
  where stage is not null and stages = '{}';

alter table public.theses drop column if exists stage;
