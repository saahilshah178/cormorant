"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  createThesisAction,
  updateThesisAction,
  type ThesisFormState,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  INDUSTRIES,
  INDUSTRY_LABELS,
  STAGES,
  STAGE_LABELS,
  type Thesis,
} from "@/lib/thesis-schema";

const initialState: ThesisFormState = { error: null };

/**
 * Thesis form: create (PLAN.md 1.1, onboarding) and edit (Thesis menu,
 * PLAN.md auth addendum) share these fields. Passing `thesis` switches it
 * into edit mode — prefilled fields, updateThesisAction instead of
 * createThesisAction, and `onSaved` instead of a redirect (update stays on
 * the same page so the Thesis menu can show the list again).
 */
export function ThesisForm({
  thesis,
  onSaved,
}: {
  thesis?: Thesis;
  onSaved?: () => void;
}) {
  const action = thesis ? updateThesisAction : createThesisAction;
  const [state, formAction, pending] = useActionState(action, initialState);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !state.error && thesis) {
      onSaved?.();
      // Editing a thesis clears its cached scores server-side; tell the open
      // deal-flow view so it can prompt a rescore (the two live in separate
      // React trees — the header vs. the page — so a window event bridges them).
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("cormorant:thesis-updated", {
            detail: { id: thesis.id },
          }),
        );
      }
    }
    wasPending.current = pending;
  }, [pending, state.error, thesis, onSaved]);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {thesis ? <input type="hidden" name="id" value={thesis.id} /> : null}

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Thesis name
        <Input
          name="name"
          placeholder="e.g. Pre-seed deeptech"
          defaultValue={thesis?.name}
          required
          autoFocus
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Stages</legend>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          {STAGES.map((s) => (
            <label
              key={s}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                name="stages"
                value={s}
                defaultChecked={
                  thesis ? thesis.stages.includes(s) : s === STAGES[0]
                }
                className="accent-primary size-4"
              />
              {STAGE_LABELS[s]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Industries</legend>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          {INDUSTRIES.map((ind) => (
            <label
              key={ind}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                name="industries"
                value={ind}
                defaultChecked={thesis?.industries.includes(ind)}
                className="accent-primary size-4"
              />
              {INDUSTRY_LABELS[ind]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Minimum traction <span className="text-muted-foreground font-normal">(optional)</span>
          <Input
            name="min_traction"
            placeholder="e.g. $1M ARR or working prototype"
            defaultValue={thesis?.min_traction ?? ""}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Founder / demographic preferences <span className="text-muted-foreground font-normal">(optional)</span>
          <Input
            name="demographics_pref"
            placeholder="e.g. technical founding team"
            defaultValue={thesis?.demographics_pref ?? ""}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Your thesis, in your own words
        <textarea
          name="raw_thesis_text"
          required
          rows={4}
          placeholder="What do you want to back, and what do you always pass on?"
          defaultValue={thesis?.raw_thesis_text ?? ""}
          className="border-input w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </label>

      {state.error ? (
        <p className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      ) : null}

      <div>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : thesis ? "Save changes" : "Save thesis"}
        </Button>
      </div>
    </form>
  );
}
