"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  ACTIVE_THESIS_COOKIE,
  createThesis,
  deleteThesis,
  getThesisById,
  updateThesis,
} from "@/lib/theses";
import { thesisInputSchema } from "@/lib/thesis-schema";
import { getCurrentUser } from "@/lib/auth";
import { getSupabaseServer } from "@/lib/supabase-server";

export type ThesisFormState = { error: string | null };

function parseThesisForm(formData: FormData) {
  return thesisInputSchema.safeParse({
    name: formData.get("name"),
    stages: formData.getAll("stages"),
    industries: formData.getAll("industries"),
    min_traction: String(formData.get("min_traction") ?? ""),
    demographics_pref: String(formData.get("demographics_pref") ?? ""),
    raw_thesis_text: formData.get("raw_thesis_text"),
  });
}

export async function createThesisAction(
  _prev: ThesisFormState,
  formData: FormData,
): Promise<ThesisFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in with Google to save a thesis." };

  const parsed = parseThesisForm(formData);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: first ? first.message : "Invalid input" };
  }

  const thesis = await createThesis(parsed.data, user.id);

  // A newly created thesis becomes the active one immediately.
  const jar = await cookies();
  jar.set(ACTIVE_THESIS_COOKIE, thesis.id, { path: "/" });

  revalidatePath("/", "layout");
  // Straight into demo step 2: the new thesis's (empty) deal flow, ready to run.
  redirect("/dealflow");
}

export async function updateThesisAction(
  _prev: ThesisFormState,
  formData: FormData,
): Promise<ThesisFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in with Google to edit a thesis." };

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing thesis id" };

  const parsed = parseThesisForm(formData);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: first ? first.message : "Invalid input" };
  }

  await updateThesis(id, parsed.data, user.id);
  revalidatePath("/", "layout");
  revalidatePath("/dealflow");
  return { error: null };
}

export async function deleteThesisAction(thesisId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;

  await deleteThesis(thesisId, user.id);

  const jar = await cookies();
  if (jar.get(ACTIVE_THESIS_COOKIE)?.value === thesisId) {
    jar.delete(ACTIVE_THESIS_COOKIE);
  }
  revalidatePath("/", "layout");
  revalidatePath("/dealflow");
}

export async function setActiveThesisAction(thesisId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;

  // Verify ownership before switching — a thesis id from a stale <select>
  // (e.g. another account's) must never become the active cookie.
  const thesis = await getThesisById(thesisId, user.id);
  if (!thesis) return;

  const jar = await cookies();
  jar.set(ACTIVE_THESIS_COOKIE, thesisId, { path: "/" });
  revalidatePath("/", "layout");
}

export async function signOutAction(): Promise<void> {
  const supabase = await getSupabaseServer();
  await supabase.auth.signOut();
  // Clear the active-thesis cookie so the next account on this browser doesn't
  // start out pointing at the previous user's selection.
  const jar = await cookies();
  jar.delete(ACTIVE_THESIS_COOKIE);
  revalidatePath("/", "layout");
  redirect("/");
}
