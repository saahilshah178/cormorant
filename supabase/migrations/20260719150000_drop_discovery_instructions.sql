-- Standing discovery instructions removed (2026-07-18): discovery is steered
-- by the active thesis alone — the VC edits the thesis (or switches to another)
-- instead of maintaining a separate instruction channel. Drops the table added
-- in 20260718170000_discovery.sql (and its user_id column / RLS from
-- 20260719120000_per_user_data.sql).
--
-- Apply via the Supabase dashboard SQL editor, same as the prior migrations.

drop table if exists public.discovery_instructions;
