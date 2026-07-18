import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client.
 *
 * Single tenant, no auth: all DB access goes through this admin client using
 * the service-role (secret) key. The env var is intentionally NOT prefixed with
 * NEXT_PUBLIC_, so it is never bundled into client code — importing this module
 * from a Client Component would fail to find the key at runtime, which is the
 * point. Do not import this from "use client" files.
 *
 * (Per PLAN.md §2: plain @supabase/supabase-js with the secret key, no
 * @supabase/ssr — that package only exists to sync auth cookies, which we do
 * not have.)
 */
let client: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY " +
        "in .env.local (and in the Vercel project settings for deploys).",
    );
  }

  client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
