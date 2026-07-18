import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { Thesis, ThesisInput } from "@/lib/thesis-schema";

/**
 * Server-side thesis access: DB reads/writes and the active-thesis cookie.
 * (Client-safe schema + constants live in lib/thesis-schema.ts.)
 *
 * The active thesis is a cookie (single tenant, no auth): server actions set
 * it, and any server-side caller (routes, pages) reads it via
 * getActiveThesis(). Downstream calls (scoring, rankings) must resolve the
 * thesis through here so switching the selector visibly changes which thesis
 * id they receive (PLAN.md 1.2).
 */

export const ACTIVE_THESIS_COOKIE = "cormorant_active_thesis";

export async function listTheses(): Promise<Thesis[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("theses")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listTheses failed: ${error.message}`);
  return data as Thesis[];
}

export async function getThesisById(id: string): Promise<Thesis | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("theses")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getThesisById failed: ${error.message}`);
  return (data as Thesis) ?? null;
}

export async function createThesis(input: ThesisInput): Promise<Thesis> {
  const { data, error } = await getSupabaseAdmin()
    .from("theses")
    .insert(input)
    .select("*")
    .single();
  if (error) throw new Error(`createThesis failed: ${error.message}`);
  return data as Thesis;
}

/**
 * Resolve the active thesis: the cookie-selected one if it still exists,
 * otherwise the oldest thesis (so the app works before any selection),
 * otherwise null (no theses yet — onboarding needed).
 */
export async function getActiveThesis(): Promise<Thesis | null> {
  const jar = await cookies();
  const id = jar.get(ACTIVE_THESIS_COOKIE)?.value;
  if (id) {
    const thesis = await getThesisById(id);
    if (thesis) return thesis;
  }
  const all = await listTheses();
  return all[0] ?? null;
}
