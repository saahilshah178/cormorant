import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { ThesisSelector } from "@/components/thesis-selector";
import { getActiveThesis, listTheses } from "@/lib/theses";
import { cn } from "@/lib/utils";

/**
 * Global header: brand + active-thesis selector (PLAN.md 1.2). Server
 * component — reads theses and the active-thesis cookie server-side. Renders
 * even when Supabase is unreachable so the marketing page never crashes.
 */
export async function SiteHeader() {
  let theses: { id: string; name: string }[] = [];
  let activeId: string | null = null;
  try {
    const [all, active] = await Promise.all([listTheses(), getActiveThesis()]);
    theses = all.map((t) => ({ id: t.id, name: t.name }));
    activeId = active?.id ?? null;
  } catch {
    // DB not configured/reachable — header still renders without the selector.
  }

  return (
    <header className="border-b">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Cormorant
        </Link>
        <div className="flex items-center gap-3">
          <ThesisSelector theses={theses} activeId={activeId} />
          <Link
            href="/onboarding"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            New thesis
          </Link>
        </div>
      </div>
    </header>
  );
}
