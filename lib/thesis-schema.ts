import { z } from "zod";

/**
 * Client-safe thesis constants + zod schema. No DB, no next/headers — this
 * module is imported by the onboarding form (client component) as well as the
 * server-side thesis lib.
 */

export const STAGES = ["pre_seed", "seed", "series_a", "series_b"] as const;

export const INDUSTRIES = [
  "ai_infra",
  "devtools",
  "consumer",
  "fintech",
  "healthcare",
  "climate",
  "robotics",
  "biotech",
  "space",
  "defense",
  "enterprise_saas",
] as const;

export const INDUSTRY_LABELS: Record<(typeof INDUSTRIES)[number], string> = {
  ai_infra: "AI infra",
  devtools: "Devtools",
  consumer: "Consumer",
  fintech: "Fintech",
  healthcare: "Healthcare",
  climate: "Climate",
  robotics: "Robotics",
  biotech: "Biotech",
  space: "Space",
  defense: "Defense",
  enterprise_saas: "Enterprise SaaS",
};

export const STAGE_LABELS: Record<(typeof STAGES)[number], string> = {
  pre_seed: "Pre-seed",
  seed: "Seed",
  series_a: "Series A",
  series_b: "Series B",
};

export const thesisInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  stages: z.array(z.enum(STAGES)).min(1, "Pick at least one stage"),
  industries: z
    .array(z.enum(INDUSTRIES))
    .min(1, "Pick at least one industry"),
  min_traction: z.string().trim().max(500).default(""),
  demographics_pref: z.string().trim().max(500).default(""),
  raw_thesis_text: z
    .string()
    .trim()
    .min(1, "Describe the thesis in your own words")
    .max(4000),
});

export type ThesisInput = z.infer<typeof thesisInputSchema>;

export type Thesis = {
  id: string;
  name: string;
  stages: string[];
  industries: string[];
  min_traction: string | null;
  demographics_pref: string | null;
  raw_thesis_text: string | null;
  created_at: string;
  user_id: string | null;
};
