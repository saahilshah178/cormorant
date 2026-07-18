"use client";

import { useTransition } from "react";
import { setActiveThesisAction } from "@/app/actions";

type Option = { id: string; name: string };

/**
 * Header selector for the active thesis (PLAN.md 1.2). Changing it runs a
 * server action that sets the active-thesis cookie, so every downstream
 * server-side call (scoring, rankings) picks up the new thesis id.
 */
export function ThesisSelector({
  theses,
  activeId,
}: {
  theses: Option[];
  activeId: string | null;
}) {
  const [pending, startTransition] = useTransition();

  if (theses.length === 0) return null;

  return (
    <select
      aria-label="Active thesis"
      className="border-input h-8 max-w-56 rounded-md border bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
      defaultValue={activeId ?? undefined}
      disabled={pending}
      onChange={(e) => {
        const id = e.target.value;
        startTransition(() => setActiveThesisAction(id));
      }}
    >
      {theses.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}
