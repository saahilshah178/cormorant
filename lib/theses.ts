import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { Thesis, ThesisInput } from "@/lib/thesis-schema";

/**
 * Server-side thesis access: DB reads/writes and the active-thesis cookie.
 * (Client-safe schema + constants live in lib/thesis-schema.ts.)
 *
 * Theses are per-user (Google sign-in via Supabase Auth, PLAN.md's auth
 * addendum): every function here takes the signed-in user's id and filters
 * on it explicitly. This is the real access control — the service-role
 * client used by getSupabaseAdmin() bypasses Postgres RLS entirely, so the
 * `theses` RLS policy (supabase/migrations/20260718140000_theses_auth.sql)
 * is defense in depth, not the enforcement mechanism.
 *
 * The active thesis is a cookie (per browser, scoped to the caller's own
 * theses): server actions set it, and any server-side caller (routes, pages)
 * reads it via getActiveThesis(). Downstream calls (scoring, rankings) must
 * resolve the thesis through here so switching the selector visibly changes
 * which thesis id they receive (PLAN.md 1.2).
 */

export const ACTIVE_THESIS_COOKIE = "cormorant_active_thesis";

export async function listTheses(userId: string): Promise<Thesis[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("theses")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listTheses failed: ${error.message}`);
  return data as Thesis[];
}

export async function getThesisById(
  id: string,
  userId: string,
): Promise<Thesis | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("theses")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`getThesisById failed: ${error.message}`);
  return (data as Thesis) ?? null;
}

export async function createThesis(
  input: ThesisInput,
  userId: string,
): Promise<Thesis> {
  const { data, error } = await getSupabaseAdmin()
    .from("theses")
    .insert({ ...input, user_id: userId })
    .select("*")
    .single();
  if (error) throw new Error(`createThesis failed: ${error.message}`);
  return data as Thesis;
}

export async function updateThesis(
  id: string,
  input: ThesisInput,
  userId: string,
): Promise<Thesis> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("theses")
    .update(input)
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error) throw new Error(`updateThesis failed: ${error.message}`);

  // Editing a thesis changes what "fit" means, so every cached score for it is
  // now stale. `scores` are cached per (company, thesis_id) and the id doesn't
  // change on edit, so without this the scoring route would treat them as
  // already-scored and skip re-scoring — the edit would never reach the map.
  // Drop them here so the next scoring run recomputes against the new thesis.
  const { error: scoresErr } = await db
    .from("scores")
    .delete()
    .eq("thesis_id", id);
  if (scoresErr)
    throw new Error(
      `updateThesis: clearing stale scores failed: ${scoresErr.message}`,
    );

  return data as Thesis;
}

export async function deleteThesis(id: string, userId: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("theses")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw new Error(`deleteThesis failed: ${error.message}`);
}

/**
 * Resolve the active thesis: the cookie-selected one if it exists AND is
 * owned by this user, otherwise this user's oldest thesis (so the app works
 * before any selection), otherwise null (no theses yet — onboarding needed).
 */
export async function getActiveThesis(userId: string): Promise<Thesis | null> {
  const jar = await cookies();
  const id = jar.get(ACTIVE_THESIS_COOKIE)?.value;
  if (id) {
    const thesis = await getThesisById(id, userId);
    if (thesis) return thesis;
  }
  const all = await listTheses(userId);
  return all[0] ?? null;
}
