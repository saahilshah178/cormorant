import { redirect } from "next/navigation";
import { DealflowView } from "@/components/dealflow-view";
import { getActiveThesis } from "@/lib/theses";
import { getCurrentUser } from "@/lib/auth";

/**
 * The deal-flow screen (PLAN.md Tier 3). Server component: resolves the
 * signed-in user's active thesis (cookie) and hands its id to the client
 * view — when the header selector changes the thesis, this re-renders and
 * the view refetches, which is what makes the map resettle (3.4).
 *
 * No signed-out branch here: middleware.ts redirects unauthenticated visits
 * to `/` before this ever renders.
 */
export default async function DealflowPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  let thesis = null;
  let dbError: string | null = null;
  try {
    thesis = await getActiveThesis(user.id);
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  if (dbError) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-16">
        <h1 className="text-xl font-semibold">Deal flow is unavailable</h1>
        <p className="text-muted-foreground mt-2 text-sm">{dbError}</p>
      </main>
    );
  }

  // New users (and anyone who deleted all their theses) go straight to
  // onboarding rather than landing on an empty deal flow.
  if (!thesis) {
    redirect("/onboarding");
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      {/* No key: the view must NOT remount on thesis swap — cached node
          objects are what make the map resettle instead of re-layout. */}
      <DealflowView thesisId={thesis.id} thesisName={thesis.name} />
    </main>
  );
}
