import { createOpenAI } from "@ai-sdk/openai";

/**
 * Single source of truth for the LLM provider and model ids.
 *
 * Everything that calls a model imports from here so the ids live in exactly
 * one place and can be swapped without hunting through the codebase.
 *
 * NOTE (per PLAN.md §2): verify these exact ids against the current OpenAI
 * platform docs before the demo. They are pinned here, and only here, so a
 * swap is a one-line change.
 */
export const MODEL_IDS = {
  /** Main scoring / reasoning model (the hard core: fit + bear case). */
  reasoning: "gpt-5.6-terra",
  /** Cheap classification / extraction model (signal parsing, discovery). */
  cheap: "gpt-5.6-luna",
} as const;

/**
 * Provider instance. Reads OPENAI_API_KEY from the environment (server-side).
 * Declared lazily-safe: constructing it does not require the key to be present,
 * so importing this module never throws at build time.
 */
export const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/** Convenience handles for the two pinned models. */
export const reasoningModel = openai(MODEL_IDS.reasoning);
export const cheapModel = openai(MODEL_IDS.cheap);
