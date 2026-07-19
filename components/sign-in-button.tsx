"use client";

import { Button } from "@/components/ui/button";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { GMAIL_SCOPE, GOOGLE_OAUTH_QUERY_PARAMS } from "@/lib/gmail-scope";

/**
 * Google OAuth sign-in. signInWithOAuth() must run in the browser (it
 * navigates the tab to Google's consent screen), so this is a client
 * component rather than a server action.
 *
 * Tier 5: the flow also requests the gmail.compose scope (drafts only,
 * never send) so One-click contact can park a draft in the VC's Gmail.
 */
export function SignInButton({
  size = "lg",
}: {
  size?: "sm" | "lg";
}) {
  return (
    <Button
      size={size}
      onClick={() => {
        const supabase = getSupabaseBrowser();
        supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: `${window.location.origin}/auth/callback`,
            scopes: GMAIL_SCOPE,
            queryParams: { ...GOOGLE_OAUTH_QUERY_PARAMS },
          },
        });
      }}
    >
      Sign in with Google
    </Button>
  );
}
