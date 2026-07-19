import { generateText, Output } from "ai";
import { z } from "zod";
import { reasoningModel } from "@/lib/models";
import type { Thesis } from "@/lib/thesis-schema";

/**
 * The scoring engine (PLAN.md §5): thesis + a company's signals in;
 * fit_score, confidence, fit_rationale, pass_reason, and the exact signal ids
 * that drove the score out. Structured JSON via the AI SDK
 * (`generateText` + `Output.object`), zod-validated, with retries that feed
 * the validation failure back to the model.
 */

export type CompanyRow = {
  id: string;
  name: string;
  website: string | null;
  github_url: string | null;
  sector: string | null;
  stage: string | null;
};

export type SignalRow = {
  id: string;
  kind: string;
  value: string | null;
  source_url: string | null;
  confidence: number | null;
};

export const scoreResultSchema = z.object({
  fit_score: z
    .number()
    .min(0)
    .max(100)
    .describe("0-100 fit of THIS company to THIS thesis (not generic quality)"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "How solid the evidence base is: count, independence, and reliability of the signals — not enthusiasm",
    ),
  fit_rationale: z
    .string()
    .min(40)
    .describe(
      "Why this fit score, referencing the specific signals by their content",
    ),
  pass_reason: z
    .string()
    .min(40)
    .describe(
      "The single sharpest falsifiable reason a disciplined investor would pass",
    ),
  contributing_signal_ids: z
    .array(z.string())
    .min(1)
    .describe("The ids of the signals that actually drove this assessment"),
});

export type ScoreResult = z.infer<typeof scoreResultSchema>;

const SYSTEM_PROMPT = `You are the scoring engine of Cormorant, a VC deal-flow system.

You receive one investment thesis and one company with its extracted signals. You output a strict JSON assessment of FIT TO THAT THESIS.

Rules:
- Score fit to the thesis, never generic "goodness" or hype. A brilliant Series B consumer app scores LOW against a pre-seed deeptech thesis: wrong stage and wrong sector are disqualifying, not minor deductions. The thesis's "stages" is the SET of stages it invests in — a company whose stage is not in that set is off-stage; a company at any stage in the set is on-stage. A company squarely inside the thesis's stages and industries with on-thesis traction scores high.
- fit_score calibration: 80-100 squarely on-thesis with strong supporting evidence; 55-79 on-thesis with gaps or thin evidence; 30-54 partial fit (right sector wrong stage, or vice versa); 0-29 off-thesis.
- confidence reflects the EVIDENCE BASE ONLY: how many independent signals exist, their source quality, and their own confidence values. Two thin signals => low confidence (≤0.4) even if the fit looks great. Five-plus corroborating signals from solid sources => high confidence (≥0.75).
- fit_rationale must reference the actual signal contents (funding amounts, metrics, names), not vague impressions.
- pass_reason is the honest bear case: ONE specific, falsifiable reason to pass, grounded in the signals or in what is conspicuously missing from them. It must be checkable ("no signal shows any revenue or usage traction despite 18 months since founding", "core product is a wrapper on a commodity model with no proprietary data"). NEVER generic filler like "the market is competitive", "execution risk", or "valuation may be high" without a specific anchor. Even for high-fit companies, find the sharpest real reason to pass.
- contributing_signal_ids must contain ONLY ids copied exactly from the provided signals — the ones that actually drove your assessment. Never invent ids.`;

function buildPrompt(
  thesis: Thesis,
  company: CompanyRow,
  signals: SignalRow[],
): string {
  return [
    "## The investment thesis",
    JSON.stringify(
      {
        name: thesis.name,
        stages: thesis.stages,
        industries: thesis.industries,
        min_traction: thesis.min_traction,
        demographics_pref: thesis.demographics_pref,
        thesis_text: thesis.raw_thesis_text,
      },
      null,
      2,
    ),
    "",
    "## The company",
    JSON.stringify(
      {
        name: company.name,
        website: company.website,
        github_url: company.github_url,
        sector: company.sector,
        stage: company.stage,
      },
      null,
      2,
    ),
    "",
    "## The company's extracted signals",
    JSON.stringify(
      signals.map((s) => ({
        id: s.id,
        kind: s.kind,
        value: s.value,
        source_url: s.source_url,
        confidence: s.confidence,
      })),
      null,
      2,
    ),
    "",
    "Assess this company's fit to this thesis. Output the JSON object only.",
  ].join("\n");
}

/** Generic pass-reason patterns that PLAN.md §5 calls bugs, not output. */
const VAGUE_PASS_REASON =
  /^(the )?(market is (highly |very )?(competitive|crowded)|execution risk|too early|high valuation)\.?$/i;

export async function scoreCompany(
  thesis: Thesis,
  company: CompanyRow,
  signals: SignalRow[],
  { maxAttempts = 3 }: { maxAttempts?: number } = {},
): Promise<ScoreResult> {
  if (signals.length === 0) {
    throw new Error(
      `scoreCompany: ${company.name} has no signals — no score without signals`,
    );
  }

  const validIds = new Set(signals.map((s) => s.id));
  let feedback = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let output: ScoreResult;
    try {
      const result = await generateText({
        model: reasoningModel,
        system: SYSTEM_PROMPT,
        prompt: buildPrompt(thesis, company, signals) + feedback,
        output: Output.object({ schema: scoreResultSchema }),
      });
      output = result.output;
    } catch (err) {
      // Invalid/unparseable output — retry with the error surfaced.
      if (attempt === maxAttempts) throw err;
      feedback = `\n\nYour previous attempt failed validation: ${err instanceof Error ? err.message.slice(0, 300) : "invalid output"}. Return valid JSON matching the schema.`;
      continue;
    }

    const badIds = output.contributing_signal_ids.filter(
      (id) => !validIds.has(id),
    );
    if (badIds.length > 0) {
      feedback = `\n\nYour previous attempt was rejected: contributing_signal_ids contained ids that are not in the provided signals (${badIds.join(", ")}). Copy ids exactly from the signals list.`;
      continue;
    }

    if (VAGUE_PASS_REASON.test(output.pass_reason.trim())) {
      feedback = `\n\nYour previous attempt was rejected: the pass_reason ("${output.pass_reason}") is generic filler. Give ONE specific, falsifiable reason grounded in these signals or in what is missing from them.`;
      continue;
    }

    return { ...output, fit_score: Math.round(output.fit_score) };
  }

  throw new Error(
    `scoreCompany: ${company.name} did not produce a valid score in ${maxAttempts} attempts`,
  );
}
