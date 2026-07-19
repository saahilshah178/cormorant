import { generateText, Output } from "ai";
import { z } from "zod";
import { cheapModel } from "@/lib/models";

/**
 * The {{fit_reason}} placeholder for One-click contact drafts (PLAN.md 5.4).
 *
 * The scoring engine's fit_rationale is internal analysis written FOR the VC
 * ("directly on-stage as a Series B company in the thesis's ai_infra
 * industry") — pasting it into an email addressed TO the founder reads as
 * jargon about themselves. This rewrites the concrete substance as one
 * natural, founder-facing sentence. A blocklist rejects any investor-internal
 * vocabulary; on failure the line is simply omitted (empty string) — a draft
 * must never leak internal analysis.
 */

const BANNED =
  /thesis|fit[ _-]?score|\bfit\b|on[- ]stage|target stage|\b[a-z]+_[a-z]+\b|rationale|scoring/i;

export async function composeFounderFitLine({
  companyName,
  fitRationale,
}: {
  companyName: string;
  fitRationale: string;
}): Promise<string> {
  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await generateText({
        model: cheapModel,
        output: Output.object({ schema: z.object({ line: z.string() }) }),
        prompt:
          `You are writing ONE sentence inside a cold outreach email an investor ` +
          `is sending TO the founders of "${companyName}". An internal scoring ` +
          `note (written for the investor, never meant to be seen by the founder) ` +
          `says why the company is interesting:\n"${fitRationale}"\n\n` +
          `Rewrite the concrete substance as one natural sentence addressed to ` +
          `the founder, e.g. "Your $75M Series B and traction in consumer ` +
          `fintech caught my eye." Rules: at most 22 words; use only facts from ` +
          `the note; NEVER use investor-internal words (thesis, fit, score, ` +
          `stage, industry) or machine slugs like ai_infra — say it the way a ` +
          `person would in an email; no empty flattery; end with a period.` +
          feedback,
      });
      const line = result.output?.line?.trim() ?? "";
      if (line && line.length <= 220 && !BANNED.test(line)) return line;
      feedback =
        `\n\nYour previous attempt ("${line.slice(0, 120)}") was rejected: it was ` +
        `empty, too long, or contained investor-internal vocabulary or ` +
        `slug_words. Write it as plain human language for the founder.`;
    } catch {
      return "";
    }
  }
  return "";
}
