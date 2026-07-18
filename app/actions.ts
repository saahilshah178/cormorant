"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ACTIVE_THESIS_COOKIE, createThesis } from "@/lib/theses";
import { thesisInputSchema } from "@/lib/thesis-schema";

export type ThesisFormState = { error: string | null };

export async function createThesisAction(
  _prev: ThesisFormState,
  formData: FormData,
): Promise<ThesisFormState> {
  const parsed = thesisInputSchema.safeParse({
    name: formData.get("name"),
    stage: formData.get("stage"),
    industries: formData.getAll("industries"),
    min_traction: String(formData.get("min_traction") ?? ""),
    demographics_pref: String(formData.get("demographics_pref") ?? ""),
    raw_thesis_text: formData.get("raw_thesis_text"),
  });

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: first ? first.message : "Invalid input" };
  }

  const thesis = await createThesis(parsed.data);

  // A newly created thesis becomes the active one immediately.
  const jar = await cookies();
  jar.set(ACTIVE_THESIS_COOKIE, thesis.id, { path: "/" });

  revalidatePath("/", "layout");
  // Straight into demo step 2: the new thesis's (empty) deal flow, ready to run.
  redirect("/dealflow");
}

export async function setActiveThesisAction(thesisId: string): Promise<void> {
  const jar = await cookies();
  jar.set(ACTIVE_THESIS_COOKIE, thesisId, { path: "/" });
  revalidatePath("/", "layout");
}
