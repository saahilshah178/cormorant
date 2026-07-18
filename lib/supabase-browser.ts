import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client — auth only (session cookies, OAuth sign-in).
 * Uses the public anon key (safe to ship to the client); never used for data
 * access, which stays server-side via lib/supabase.ts's service-role client.
 */
export function getSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
