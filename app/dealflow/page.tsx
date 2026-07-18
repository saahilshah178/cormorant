import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { DealflowView } from "@/components/dealflow-view";
import { getActiveThesis } from "@/lib/theses";
import { cn } from "@/lib/utils";

/**
 * The deal-flow screen (PLAN.md Tier 3). Server component: resolves the
 * active thesis (cookie) and hands its id to the client view — when the
 * header selector changes the thesis, this re-renders and the view refetches,
 * which is what makes the map resettle (3.4).
 */
export default async function DealflowPage() {
  let thesis = null;
  let dbError: string | null = null;
  try {
    thesis = await getActiveThesis();
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

  if (!thesis) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start justify-center px-6 py-16">
        <h1 className="text-xl font-semibold">First, describe your thesis</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Every score in Cormorant is fit-to-thesis, so the deal flow needs a
          thesis before it can rank anything. It takes about 15 seconds.
        </p>
        <Link
          href="/onboarding"
          className={cn(buttonVariants({ size: "lg" }), "mt-6")}
        >
          Describe your thesis
        </Link>
      </main>
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      {/* No key: the view must NOT remount on thesis swap — cached node
          objects are what make the map resettle instead of re-layout. */}
      <DealflowView thesisId={thesis.id} thesisName={thesis.name} />
    </main>
  );
}
