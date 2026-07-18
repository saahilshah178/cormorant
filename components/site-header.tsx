import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ThesisSelector } from "@/components/thesis-selector";
import { ThesisMenu } from "@/components/thesis-menu";
import { SignInButton } from "@/components/sign-in-button";
import { signOutAction } from "@/app/actions";
import { getActiveThesis, listTheses } from "@/lib/theses";
import { getCurrentUser } from "@/lib/auth";

/**
 * Global header: brand + auth + active-thesis selector (PLAN.md 1.2, auth
 * addendum). Server component — reads the Supabase session and, when
 * signed in, the user's own theses + active-thesis cookie. Renders even
 * when Supabase is unreachable so the marketing page never crashes.
 */
export async function SiteHeader() {
  const user = await getCurrentUser();

  let theses: Awaited<ReturnType<typeof listTheses>> = [];
  let activeId: string | null = null;
  if (user) {
    try {
      const [all, active] = await Promise.all([
        listTheses(user.id),
        getActiveThesis(user.id),
      ]);
      theses = all;
      activeId = active?.id ?? null;
    } catch {
      // DB not configured/reachable — header still renders without the selector.
    }
  }

  return (
    <header className="border-b">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-3">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Cormorant
          </Link>
          <Link
            href="/dealflow"
            className="text-muted-foreground hover:text-foreground text-sm"
          >
            Deal flow
          </Link>
        </div>
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <ThesisSelector
                theses={theses.map((t) => ({ id: t.id, name: t.name }))}
                activeId={activeId}
              />
              <ThesisMenu theses={theses} />
              <span className="text-muted-foreground hidden max-w-40 truncate text-sm sm:inline">
                {user.email}
              </span>
              <form action={signOutAction}>
                <Button type="submit" variant="ghost" size="sm">
                  Sign out
                </Button>
              </form>
            </>
          ) : (
            <SignInButton size="sm" />
          )}
        </div>
      </div>
    </header>
  );
}
