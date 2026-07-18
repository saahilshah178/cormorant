"use client";

import { useActionState } from "react";
import { createThesisAction, type ThesisFormState } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  INDUSTRIES,
  INDUSTRY_LABELS,
  STAGES,
  STAGE_LABELS,
} from "@/lib/thesis-schema";

const initialState: ThesisFormState = { error: null };

/**
 * Thesis onboarding form (PLAN.md 1.1). Designed to be completable in ~15
 * seconds: one name, one stage, tick industries, two optional short fields,
 * one free-text box. Server action validates with zod and persists to
 * `theses`, then makes the new thesis active and redirects home.
 */
export function ThesisForm() {
  const [state, formAction, pending] = useActionState(
    createThesisAction,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Thesis name
          <Input
            name="name"
            placeholder="e.g. Pre-seed deeptech"
            required
            autoFocus
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Stage
          <select
            name="stage"
            required
            defaultValue={STAGES[0]}
            className="border-input h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

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
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Founder / demographic preferences <span className="text-muted-foreground font-normal">(optional)</span>
          <Input
            name="demographics_pref"
            placeholder="e.g. technical founding team"
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
          {pending ? "Saving…" : "Save thesis"}
        </Button>
      </div>
    </form>
  );
}
