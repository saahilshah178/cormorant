import { getWritable } from "workflow";
import { generateText, Output } from "ai";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase";
import { cheapModel } from "@/lib/models";
import { scoreCompany, type SignalRow } from "@/lib/scoring";
import {
  FIXED_SOURCES,
  fetchSourceCandidates,
  type Candidate,
  type SourceKey,
} from "@/lib/discovery/sources";
import type { Thesis } from "@/lib/thesis-schema";

/**
 * Tier 4 discovery pipeline (PLAN.md 4.3), a Workflow DevKit durable run:
 *
 *   parallel scraper steps (one per fixed source + the search step, each
 *   reading the thesis + active discovery_instructions)
 *     → parallel review steps (dedupe against existing companies, fetch the
 *       source_url and verify it actually mentions the company, extract
 *       structured signals with the cheap model, reject anything uncited)
 *     → a grading step per candidate that calls the same scoreCompany as
 *       Tier 2, unchanged
 *     → insert (company + signals + score, tagged source='discovery:<key>')
 *
 * The workflow function only orchestrates; all real work (fetch, LLM, DB)
 * lives in "use step" functions with full Node access. Errors are caught
 * INSIDE steps and returned as empty/null results, so one candidate or source
 * failing never drops data already inserted and never burns step retries on
 * known-blocked sources.
 *
 * Loop control: each round excludes companies already indexed or already
 * reviewed this run, so successive rounds advance deeper into the sources
 * instead of re-picking the same top candidates (which review would only
 * reject as dupes). The run loops until it hits target_count, or until the
 * sources genuinely stop yielding new companies (MAX_DRY_ROUNDS consecutive
 * empty rounds), bounded by a MAX_TOTAL_ROUNDS safety cap; the search agent
 * rotates its query each round (and probes a niche vertical on some rounds) so
 * the net keeps widening. A cooperative Stop flips discovery_runs.status, which
 * the loop checks between rounds. Note: @workflow/ai's DurableAgent (PLAN.md §2)
 * requires ai@^6 and this repo is on ai@7, so agents are plain generateText
 * calls inside steps — same durability, no sandbox issues.
 */

export type DiscoveryInput = {
  runId: string;
  targetCount: number;
  thesis: Thesis;
};

type RunContext = {
  status: string;
  instructions: string;
  existingNames: string[];
  existingDomains: string[];
};

type ReviewedCandidate = {
  name: string;
  website: string | null;
  sector: string | null;
  stage: string | null;
  source: SourceKey;
  source_url: string;
  signals: { kind: string; value: string; confidence: number }[];
};

/* ----------------------------- log helpers ----------------------------- */
/* Namespaced streams per PLAN.md: verbose per-agent logs stay out of the
 * default stream, which only carries events the map/UI needs. */

async function writeLine(namespace: string | undefined, line: string) {
  "use step";
  const writable = namespace
    ? getWritable<string>({ namespace })
    : getWritable<string>();
  const writer = writable.getWriter();
  try {
    await writer.write(line + "\n");
  } finally {
    writer.releaseLock();
  }
}

/* ------------------------------- steps --------------------------------- */

async function loadContext(runId: string): Promise<RunContext> {
  "use step";
  const db = getSupabaseAdmin();
  const [runRes, instrRes, companiesRes] = await Promise.all([
    db.from("discovery_runs").select("status").eq("id", runId).maybeSingle(),
    db
      .from("discovery_instructions")
      .select("text")
      .eq("active", true)
      .order("created_at", { ascending: true }),
    db.from("companies").select("name, website"),
  ]);
  const instructions = (instrRes.data ?? [])
    .map((r) => r.text)
    .filter(Boolean)
    .join("\n");
  const existingNames = (companiesRes.data ?? []).map((c) =>
    normalizeName(c.name),
  );
  const existingDomains = (companiesRes.data ?? [])
    .map((c) => domainOf(c.website))
    .filter((d): d is string => Boolean(d));
  return {
    status: runRes.data?.status ?? "running",
    instructions,
    existingNames,
    existingDomains,
  };
}

const scraperPickSchema = z.object({
  selected: z
    .array(z.number().int().min(0))
    .max(8)
    .describe("Indices of the candidates worth reviewing, best first"),
});

/**
 * One scraper agent: fetch+parse a source, drop anything already indexed or
 * already reviewed this run (so each round advances to fresh companies rather
 * than re-triaging the same top picks), then let the cheap model pick the few
 * worth the review pass given the thesis + VC instructions.
 */
async function scrapeSource(
  key: SourceKey,
  thesisSummary: string,
  instructions: string,
  excludeKeys: string[],
  searchQuery?: string,
): Promise<Candidate[]> {
  "use step";
  const log = (msg: string) => writeLineInStep("logs:scraper", `[${key}] ${msg}`);
  let raw: Candidate[];
  try {
    raw = await fetchSourceCandidates(key, searchQuery);
  } catch (err) {
    await log(`fetch failed: ${err instanceof Error ? err.message : err}`);
    return [];
  }
  if (raw.length === 0) {
    await log("0 candidates (source empty or blocked)");
    return [];
  }

  // Drop anything already indexed or already reviewed this run BEFORE triage,
  // so each round surfaces fresh companies deeper in the source instead of the
  // same top picks (which review would only reject as dupes).
  const exclude = new Set(excludeKeys);
  const fresh = raw.filter((c) => !exclude.has(normalizeName(c.name)));
  const droppedSeen = raw.length - fresh.length;
  if (fresh.length === 0) {
    await log(`${raw.length} raw, all already seen — nothing fresh`);
    return [];
  }
  await log(
    `${fresh.length} fresh candidate${fresh.length === 1 ? "" : "s"}` +
      `${droppedSeen ? ` (${droppedSeen} already seen)` : ""}` +
      `${searchQuery ? ` for "${searchQuery}"` : ""}`,
  );

  try {
    const { output } = await generateText({
      model: cheapModel,
      system:
        "You triage raw startup-discovery mentions for a VC deal-flow pipeline. " +
        "Select ONLY plausible startup companies (not libraries, listicles, blog posts, or hobby demos with no company behind them) " +
        "that are worth a deeper review given the VC's thesis and instructions. Prefer on-thesis or adjacent candidates. " +
        "Return at most 8 indices, best first. Return an empty list if nothing qualifies.",
      prompt: [
        `## VC thesis\n${thesisSummary}`,
        instructions ? `## Standing VC instructions\n${instructions}` : "",
        `## Candidates from source "${key}"`,
        JSON.stringify(
          fresh.map((c, i) => ({ i, name: c.name, snippet: c.snippet })),
          null,
          1,
        ),
      ]
        .filter(Boolean)
        .join("\n\n"),
      output: Output.object({ schema: scraperPickSchema }),
    });
    const picked = output.selected
      .filter((i) => i >= 0 && i < fresh.length)
      .slice(0, 8)
      .map((i) => fresh[i]);
    await log(
      `picked ${picked.length}: ${picked.map((c) => c.name).join(", ") || "—"}`,
    );
    return picked;
  } catch (err) {
    await log(
      `triage failed (${err instanceof Error ? err.message.slice(0, 120) : err}); passing top 3 fresh`,
    );
    return fresh.slice(0, 3);
  }
}

const reviewSchema = z.object({
  is_startup: z
    .boolean()
    .describe("true only if this is a real startup company (not a library, listicle, or hobby project)"),
  name: z.string().min(1).describe("The company's canonical name"),
  website: z.string().nullable().describe("The company's own website URL, if evident"),
  sector: z
    .enum([
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
    ])
    .nullable(),
  stage: z.enum(["pre_seed", "seed", "series_a", "series_b"]).nullable(),
  signals: z
    .array(
      z.object({
        kind: z.enum([
          "commit_cadence",
          "hire",
          "funding",
          "customer_mention",
          "traction",
          "press",
          "other",
        ]),
        value: z
          .string()
          .min(10)
          .describe("The concrete claim, grounded ONLY in the provided page content"),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(4)
    .describe("Signals extractable from the page content; empty if none"),
});

/**
 * One review agent per candidate: dedupe, verify the source URL actually
 * loads and mentions the company, extract structured signals (cheap model).
 * Returns null when rejected (with the reason logged).
 */
async function reviewCandidate(
  candidate: Candidate,
  thesisSummary: string,
  instructions: string,
  existingNames: string[],
  existingDomains: string[],
): Promise<ReviewedCandidate | null> {
  "use step";
  const log = (msg: string) =>
    writeLineInStep("logs:review", `[${candidate.name}] ${msg}`);

  const normName = normalizeName(candidate.name);
  if (existingNames.includes(normName)) {
    await log("rejected: already indexed (name match)");
    return null;
  }
  const candDomain = domainOf(candidate.website);
  if (candDomain && existingDomains.includes(candDomain)) {
    await log("rejected: already indexed (domain match)");
    return null;
  }

  // Verify the citation: the source_url must load and mention the candidate.
  let pageText: string;
  try {
    const res = await fetch(candidate.source_url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CormorantBot/1.0)" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      await log(`rejected: source_url ${res.status} — not citable`);
      return null;
    }
    pageText = (await res.text())
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 6000);
  } catch (err) {
    await log(
      `rejected: source_url unreachable (${err instanceof Error ? err.message.slice(0, 80) : err})`,
    );
    return null;
  }
  const nameToken = candidate.name.split(/[\s:–—-]+/)[0]?.toLowerCase() ?? "";
  if (nameToken && !pageText.toLowerCase().includes(nameToken)) {
    await log("rejected: page does not mention the company — citation unsupported");
    return null;
  }

  let extracted: z.infer<typeof reviewSchema>;
  try {
    const { output } = await generateText({
      model: cheapModel,
      system:
        "You are the review agent of a VC discovery pipeline. From a candidate mention and the ACTUAL text of its source page, " +
        "decide if this is a real startup company and extract structured signals. Every signal's value must be a concrete claim " +
        "supported by the provided page content — never invent facts not on the page. If the page doesn't support a real signal, return an empty signals list.",
      prompt: [
        `## VC thesis (context only — do NOT reject off-thesis companies here; grading handles fit)\n${thesisSummary}`,
        instructions ? `## Standing VC instructions\n${instructions}` : "",
        `## Candidate\n${JSON.stringify({ name: candidate.name, snippet: candidate.snippet, source: candidate.source, source_url: candidate.source_url, website: candidate.website })}`,
        `## Source page content (truncated)\n${pageText}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      output: Output.object({ schema: reviewSchema }),
    });
    extracted = output;
  } catch (err) {
    await log(
      `rejected: extraction failed (${err instanceof Error ? err.message.slice(0, 120) : err})`,
    );
    return null;
  }

  if (!extracted.is_startup) {
    await log("rejected: not a startup company");
    return null;
  }
  if (extracted.signals.length === 0) {
    await log("rejected: no citable signals on the source page");
    return null;
  }
  // Re-check dedupe under the extracted canonical name/site too.
  if (existingNames.includes(normalizeName(extracted.name))) {
    await log("rejected: already indexed (canonical name match)");
    return null;
  }
  const extractedDomain = domainOf(extracted.website ?? candidate.website);
  if (extractedDomain && existingDomains.includes(extractedDomain)) {
    await log("rejected: already indexed (canonical domain match)");
    return null;
  }

  await log(
    `accepted: ${extracted.signals.length} signal(s), sector=${extracted.sector ?? "?"}, stage=${extracted.stage ?? "?"}`,
  );
  return {
    name: extracted.name,
    website: extracted.website ?? candidate.website,
    sector: extracted.sector,
    stage: extracted.stage,
    source: candidate.source,
    source_url: candidate.source_url,
    signals: extracted.signals,
  };
}

/**
 * Grading + insert: company + signals in, scoreCompany (Tier 2, unchanged)
 * over the freshly inserted signal rows, score persisted, run counter bumped.
 * A scoring failure rolls the company back (no score without its signals —
 * and no node without a score).
 */
async function insertAndGrade(
  reviewed: ReviewedCandidate,
  thesis: Thesis,
  runId: string,
  foundSoFar: number,
): Promise<{ inserted: boolean; total: number }> {
  "use step";
  const log = (msg: string) =>
    writeLineInStep("logs:grading", `[${reviewed.name}] ${msg}`);
  const db = getSupabaseAdmin();

  // Last-line dedupe against the live DB (covers races and prior rounds).
  const { data: dupes } = await db
    .from("companies")
    .select("id, name")
    .ilike("name", reviewed.name);
  if ((dupes ?? []).length > 0) {
    await log("skipped: already in companies (live check)");
    return { inserted: false, total: foundSoFar };
  }

  const { data: company, error: cErr } = await db
    .from("companies")
    .insert({
      name: reviewed.name,
      website: reviewed.website,
      sector: reviewed.sector,
      stage: reviewed.stage,
      source: `discovery:${reviewed.source}`,
    })
    .select("id, name, website, github_url, sector, stage")
    .single();
  if (cErr || !company) {
    await log(`insert failed: ${cErr?.message ?? "no row"}`);
    return { inserted: false, total: foundSoFar };
  }

  const { data: signalRows, error: sErr } = await db
    .from("signals")
    .insert(
      reviewed.signals.map((s) => ({
        company_id: company.id,
        kind: s.kind,
        value: s.value,
        source_url: reviewed.source_url,
        confidence: s.confidence,
      })),
    )
    .select("id, kind, value, source_url, confidence");
  if (sErr || !signalRows?.length) {
    await db.from("companies").delete().eq("id", company.id);
    await log(`signals insert failed: ${sErr?.message ?? "no rows"} — rolled back`);
    return { inserted: false, total: foundSoFar };
  }

  try {
    const result = await scoreCompany(thesis, company, signalRows as SignalRow[]);
    const { error: scErr } = await db.from("scores").insert({
      company_id: company.id,
      thesis_id: thesis.id,
      fit_score: result.fit_score,
      confidence: result.confidence,
      fit_rationale: result.fit_rationale,
      pass_reason: result.pass_reason,
      contributing_signal_ids: result.contributing_signal_ids,
    });
    if (scErr) throw new Error(`score persist failed: ${scErr.message}`);

    const total = foundSoFar + 1;
    await db
      .from("discovery_runs")
      .update({ companies_found: total })
      .eq("id", runId);
    await log(`scored ${result.fit_score}/100 (confidence ${result.confidence})`);
    // Default stream: only the events the map cares about.
    await writeLineInStep(
      undefined,
      JSON.stringify({
        type: "company_inserted",
        company_id: company.id,
        name: company.name,
        fit_score: result.fit_score,
        source: `discovery:${reviewed.source}`,
      }),
    );
    return { inserted: true, total };
  } catch (err) {
    // Roll back so the map never shows an unscored ghost node.
    await db.from("companies").delete().eq("id", company.id);
    await log(
      `grading failed, rolled back: ${err instanceof Error ? err.message.slice(0, 160) : err}`,
    );
    return { inserted: false, total: foundSoFar };
  }
}

async function finishRun(
  runId: string,
  status: "completed" | "stopped" | "failed",
  found: number,
) {
  "use step";
  const db = getSupabaseAdmin();
  await db
    .from("discovery_runs")
    .update({
      status,
      companies_found: found,
      stopped_at: new Date().toISOString(),
    })
    .eq("id", runId);
  await writeLineInStep(
    undefined,
    JSON.stringify({ type: "run_finished", status, companies_found: found }),
  );
}

/* Helper used INSIDE steps (plain async fn — full Node access there). */
async function writeLineInStep(namespace: string | undefined, line: string) {
  const writable = namespace
    ? getWritable<string>({ namespace })
    : getWritable<string>();
  const writer = writable.getWriter();
  try {
    await writer.write(line + "\n");
  } finally {
    writer.releaseLock();
  }
}

/* ------------------------- pure helpers (both) -------------------------- */

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|labs?|ai|hq|technologies|tech)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return null;
  }
}

function summarizeThesis(thesis: Thesis): string {
  return JSON.stringify({
    name: thesis.name,
    stage: thesis.stage,
    industries: thesis.industries,
    min_traction: thesis.min_traction,
    demographics_pref: thesis.demographics_pref,
    thesis_text: thesis.raw_thesis_text,
  });
}

/**
 * Rotating broaden-the-net query. Each round it varies the industry (round-robin
 * over the thesis industries) AND the query shape, and on ~every third round it
 * probes a niche sub-vertical instead of the broad thesis term — so discovery
 * reaches beyond the obvious on-thesis names into specialized / adjacent
 * companies the fixed sources miss.
 */
const QUERY_SHAPES = [
  (industry: string, stage: string) => `${industry} startup ${stage} launch`,
  (industry: string, stage: string) =>
    `${industry} ${stage} funding announcement`,
  (industry: string) => `new ${industry} company building`,
  (industry: string) => `early stage ${industry} startup`,
];

const NICHE_QUALIFIERS = [
  "infrastructure",
  "developer tools",
  "vertical SaaS",
  "open source",
  "API platform",
  "automation",
  "marketplace",
  "protocol",
  "AI agents",
];

function buildSearchQuery(thesis: Thesis, round: number): string {
  const industries = thesis.industries?.length ? thesis.industries : ["AI"];
  const industry = industries[(round - 1) % industries.length];
  const stage = thesis.stage ? thesis.stage.replace("_", "-") : "seed";

  // Every third round: narrow into a niche vertical rather than the broad term.
  if (round % 3 === 0) {
    const qualifier = NICHE_QUALIFIERS[(round - 1) % NICHE_QUALIFIERS.length];
    return `${industry} ${qualifier} startup`;
  }
  const shape = QUERY_SHAPES[(round - 1) % QUERY_SHAPES.length];
  return shape(industry, stage);
}

function dedupeCandidates(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of candidates) {
    const key = normalizeName(c.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/* ------------------------------ workflow -------------------------------- */

const MAX_TOTAL_ROUNDS = 15; // safety cap (bounds cost if sources never drain)
const MAX_DRY_ROUNDS = 3; // stop after this many consecutive rounds add nothing new
const MAX_REVIEWS_PER_ROUND = 16; // ceiling on the review-step fan-out per round

export async function discoveryWorkflow(input: DiscoveryInput) {
  "use workflow";

  const target = Math.max(1, input.targetCount);
  const thesisSummary = summarizeThesis(input.thesis);

  let found = 0;
  let status: "completed" | "stopped" | "failed" = "completed";
  // Normalized names of every candidate reviewed this run (accepted → also in
  // the DB; rejected → not). Excluding these from each round's triage is what
  // advances discovery deeper into the sources instead of re-picking the same
  // top candidates every round. Rebuilt deterministically from step outputs on
  // replay, so it is safe to hold across the durable loop.
  const reviewedKeys = new Set<string>();

  try {
    let round = 0;
    let dryRounds = 0;
    while (found < target) {
      round++;
      const ctx = await loadContext(input.runId);
      if (ctx.status === "stopped") {
        status = "stopped";
        break;
      }

      // Everything already indexed (DB) or already tried this run (rejects too).
      const excludeKeys = Array.from(
        new Set([...ctx.existingNames, ...reviewedKeys]),
      );
      await writeLine(
        "logs:scraper",
        `— round ${round}: scraping ${FIXED_SOURCES.length} fixed sources + search (excluding ${excludeKeys.length} already seen) —`,
      );

      // Parallel scraper agents (one per fixed source + the search agent).
      const batches = await Promise.all([
        ...FIXED_SOURCES.map((key) =>
          scrapeSource(key, thesisSummary, ctx.instructions, excludeKeys),
        ),
        scrapeSource(
          "search",
          thesisSummary,
          ctx.instructions,
          excludeKeys,
          buildSearchQuery(input.thesis, round),
        ),
      ]);

      // Review only as many as we plausibly still need (2× the remaining gap to
      // absorb rejects), capped, so we never over-review past the target.
      const need = target - found;
      const reviewBudget = Math.min(
        Math.max(4, need * 2),
        MAX_REVIEWS_PER_ROUND,
      );
      const candidates = dedupeCandidates(batches.flat())
        .filter((c) => !reviewedKeys.has(normalizeName(c.name)))
        .slice(0, reviewBudget);
      // Mark this round's candidates seen so the next round advances past them.
      for (const c of candidates) reviewedKeys.add(normalizeName(c.name));

      if (candidates.length === 0) {
        await writeLine(
          "logs:review",
          `— round ${round}: no fresh candidates (sources drained) —`,
        );
      } else {
        await writeLine(
          "logs:review",
          `— round ${round}: reviewing ${candidates.length} fresh candidate${candidates.length === 1 ? "" : "s"} (need ${need}) —`,
        );
      }

      // Parallel review agents, one step per candidate (failure-isolated).
      const reviewed = await Promise.all(
        candidates.map((c) =>
          reviewCandidate(
            c,
            thesisSummary,
            ctx.instructions,
            ctx.existingNames,
            ctx.existingDomains,
          ),
        ),
      );
      const accepted = reviewed.filter(
        (r): r is ReviewedCandidate => r !== null,
      );
      await writeLine(
        "logs:grading",
        `— round ${round}: grading ${accepted.length} accepted candidates —`,
      );

      // Grade + insert sequentially so nodes drop onto the map one by one
      // and the run counter never races.
      const foundBefore = found;
      for (const r of accepted) {
        if (found >= target) break;
        const res = await insertAndGrade(r, input.thesis, input.runId, found);
        found = res.total;
      }
      const addedThisRound = found - foundBefore;

      if (found >= target) break;

      // Loop-until-dry: keep going while rounds still yield new companies; stop
      // once they stop (sources genuinely exhausted) or the hard round cap hits.
      dryRounds = addedThisRound > 0 ? 0 : dryRounds + 1;
      if (dryRounds >= MAX_DRY_ROUNDS) {
        await writeLine(
          "logs:grading",
          `— sources drained: ${found}/${target} found after ${round} rounds —`,
        );
        break;
      }
      if (round >= MAX_TOTAL_ROUNDS) {
        await writeLine(
          "logs:grading",
          `— round cap reached: ${found}/${target} found —`,
        );
        break;
      }
    }
  } catch (err) {
    await finishRun(input.runId, "failed", found);
    throw err;
  }

  await finishRun(input.runId, status, found);
  return { found, status };
}
