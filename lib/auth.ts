import { getSupabaseServer } from "@/lib/supabase-server";

/**
 * The signed-in user for the current request, or null. All thesis CRUD and
 * the active-thesis resolution are scoped to this id (lib/theses.ts).
 */
export async function getCurrentUser() {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
