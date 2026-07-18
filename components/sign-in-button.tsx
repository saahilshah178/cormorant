"use client";

import { Button } from "@/components/ui/button";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

/**
 * Google OAuth sign-in. signInWithOAuth() must run in the browser (it
 * navigates the tab to Google's consent screen), so this is a client
 * component rather than a server action.
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
          },
        });
      }}
    >
      Sign in with Google
    </Button>
  );
}
