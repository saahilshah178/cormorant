import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { saveProviderTokens } from "@/lib/gmail";

/**
 * Google OAuth redirect target (configured in the Supabase dashboard under
 * Authentication -> URL Configuration -> Redirect URLs). Exchanges the
 * auth code for a session, which @supabase/ssr persists as cookies, then
 * sends the user on to their first thesis screen.
 *
 * Tier 5: the session's Google provider tokens (gmail.compose scope) are
 * captured server-side here — Supabase surfaces provider_token /
 * provider_refresh_token only on this initial exchange and does not refresh
 * them itself, so this is the one moment to persist them (PLAN.md 5.1).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dealflow";

  if (code) {
    const supabase = await getSupabaseServer();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const session = data?.session;
      if (session?.provider_token && session.user) {
        try {
          await saveProviderTokens(
            session.user.id,
            session.provider_token,
            session.provider_refresh_token ?? null,
          );
        } catch {
          // Token capture is best-effort: sign-in itself must never fail on
          // it. One-click contact will ask to reconnect Gmail if needed.
        }
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/?auth_error=1`);
}
