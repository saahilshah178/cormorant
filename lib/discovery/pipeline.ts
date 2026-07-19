import { getWritable } from "workflow";
import { generateText, Output } from "ai";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase";
import { cheapModel } from "@/lib/models";
import { scoreCompany, type SignalRow } from "@/lib/scoring";
import {
  FIXED_SOURCES,
  fetchSourceCandidates,
  get as httpGet,
  type Candidate,
  type SourceKey,
} from "@/lib/discovery/sources";
import {
  INDUSTRY_LABELS,
  STAGE_LABELS,
  type Thesis,
} from "@/lib/thesis-schema";

/**
 * Tier 4 discovery pipeline (PLAN.md 4.3), a Workflow DevKit durable run:
 *
 *   parallel scraper steps (one per fixed source + the query-driven search and
 *   funding-news steps, each steered by the active thesis alone — the VC edits
 *   the thesis to steer discovery; there is no separate instruction channel)
 *     → parallel review steps (dedupe against existing companies, verify the
 *       citation actually loads and mentions the company — falling back to the
 *       company's own website, then to the source's first-party feed excerpt,
 *       when the source page bot-walls server fetches — and extract structured
 *       signals with the cheap model, rejecting anything uncited)
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
  userId: string;
};

type RunContext = {
  status: string;
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

async function loadContext(runId: string, userId: string): Promise<RunContext> {
  "use step";
  const db = getSupabaseAdmin();
  const [runRes, companiesRes] = await Promise.all([
    db.from("discovery_runs").select("status").eq("id", runId).maybeSingle(),
    // Dedupe against the shared seed pool + this VC's own companies, so each
    // account can independently discover a company another account already has.
    db
      .from("companies")
      .select("name, website")
      .or(`user_id.is.null,user_id.eq.${userId}`),
  ]);
  const existingNames = (companiesRes.data ?? []).map((c) =>
    normalizeName(c.name),
  );
  const existingDomains = (companiesRes.data ?? [])
    .map((c) => domainOf(c.website))
    .filter((d): d is string => Boolean(d));
  return {
    status: runRes.data?.status ?? "running",
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
 * worth the review pass given the thesis.
 */
async function scrapeSource(
  key: SourceKey,
  thesisSummary: string,
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
        "that are worth a deeper review given the VC's thesis. Prefer on-thesis or adjacent candidates, and respect the thesis's target stages: " +
        "when the thesis targets later stages (Series A/B), skip fresh hobby launches and tiny demos that cannot plausibly be there yet; " +
        "when it targets pre-seed/seed, skip large established companies. " +
        "Return at most 8 indices, best first. Return an empty list if nothing qualifies.",
      prompt: [
        `## VC thesis\n${thesisSummary}`,
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

/** The verified evidence a review decision is grounded in: the page text that
 * was actually fetched, and the URL that becomes the signals' citation. `thin`
 * means the source bot-walls server fetches and the only verifiable content is
 * the source's own feed/API excerpt — allowed, but confidence-capped. */
type Evidence = { text: string; url: string; thin: boolean };

/** Fetch a page as evidence text (tags stripped), with one retry on transient
 * failures. Uses the same browser-like headers as the source fetchers — the
 * old "CormorantBot" UA was itself the cause of many 403 "not citable" rejects. */
async function fetchPageText(
  url: string,
): Promise<{ ok: boolean; status: number; text: string }> {
  for (let attempt = 0; ; attempt++) {
    let status = 0;
    try {
      const res = await httpGet(url);
      status = res.status;
      if (res.ok) {
        const text = (await res.text())
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .slice(0, 6000);
        return { ok: true, status, text };
      }
    } catch {
      // network error / timeout — retry once below
    }
    if (attempt === 0 && (status === 0 || status === 429 || status >= 500)) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    return { ok: false, status, text: "" };
  }
}

/**
 * Resolve the evidence page for a candidate. Chain: the source page itself →
 * the company's own website (when the source bot-walls server fetches but the
 * page exists for a human clicking the citation) → the source's first-party
 * feed excerpt (e.g. Product Hunt, whose post pages 403 every server fetch but
 * whose feed IS producthunt.com's own content about the candidate). A 404/410
 * or a page that doesn't mention the company still rejects outright.
 */
async function resolveEvidence(
  candidate: Candidate,
  log: (msg: string) => Promise<void>,
): Promise<Evidence | null> {
  const nameToken = candidate.name.split(/[\s:–—-]+/)[0]?.toLowerCase() ?? "";
  const mentions = (text: string) =>
    !nameToken || text.toLowerCase().includes(nameToken);

  const src = await fetchPageText(candidate.source_url);
  if (src.ok) {
    if (mentions(src.text)) {
      return { text: src.text, url: candidate.source_url, thin: false };
    }
    await log("rejected: page does not mention the company — citation unsupported");
    return null;
  }
  if (src.status === 404 || src.status === 410) {
    await log(`rejected: source_url ${src.status} — page gone`);
    return null;
  }
  const blocked = src.status || "unreachable";
  const siteUrl = candidate.website
    ? candidate.website.startsWith("http")
      ? candidate.website
      : `https://${candidate.website}`
    : null;
  if (siteUrl && domainOf(siteUrl) !== domainOf(candidate.source_url)) {
    const site = await fetchPageText(siteUrl);
    if (site.ok && mentions(site.text)) {
      await log(
        `source_url blocked (${blocked}); citing the company website instead`,
      );
      return { text: site.text, url: siteUrl, thin: false };
    }
  }
  if (candidate.snippet.trim().length >= 40) {
    await log(
      `source_url bot-walled (${blocked}); grounding in the source's own feed excerpt — thin evidence`,
    );
    return { text: candidate.snippet, url: candidate.source_url, thin: true };
  }
  await log(`rejected: source_url ${blocked} and no fallback evidence`);
  return null;
}

/** Thin-evidence signals never claim more confidence than a one-line feed
 * excerpt can support — enforced in code, not just asked of the model. */
const THIN_EVIDENCE_MAX_CONFIDENCE = 0.4;

/**
 * One review agent per candidate: dedupe, verify the citation actually loads
 * and mentions the company (with the resolveEvidence fallback chain), extract
 * structured signals (cheap model). Returns null when rejected (reason logged).
 */
async function reviewCandidate(
  candidate: Candidate,
  thesisSummary: string,
  existingNames: string[],
  existingDomains: string[],
  allowedStages: string[],
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

  const evidence = await resolveEvidence(candidate, log);
  if (!evidence) return null; // reason already logged

  let extracted: z.infer<typeof reviewSchema>;
  try {
    const { output } = await generateText({
      model: cheapModel,
      system:
        "You are the review agent of a VC discovery pipeline. From a candidate mention and the ACTUAL text of its source page, " +
        "decide if this is a real startup company and extract structured signals. Every signal's value must be a concrete claim " +
        "supported by the provided page content — never invent facts not on the page. If the page doesn't support a real signal, return an empty signals list. " +
        "Determine the company's funding stage (pre_seed, seed, series_a, series_b) from the page — infer it from funding-round mentions, raise amounts, team size, and launch recency. Use null ONLY when the page gives no basis to judge stage.",
      prompt: [
        `## VC thesis (sector/fit is graded later — do NOT reject off-sector companies here)\n${thesisSummary}`,
        allowedStages.length
          ? `## Target stages\nThe VC only wants companies at these stages: ${allowedStages.join(", ")}. Determine the company's stage as accurately as you can from the page.`
          : "",
        `## Candidate\n${JSON.stringify({ name: candidate.name, snippet: candidate.snippet, source: candidate.source, source_url: candidate.source_url, website: candidate.website })}`,
        evidence.thin
          ? `## Evidence caveat\nThe cited page blocks server-side fetches (it loads normally in a browser). The ONLY verifiable content is the source's own published excerpt below. Extract at most 2 signals grounded strictly in it, and cap every signal's confidence at ${THIN_EVIDENCE_MAX_CONFIDENCE}.`
          : "",
        `## ${evidence.thin ? "Source feed excerpt (the only verifiable content)" : "Source page content (truncated)"}\n${evidence.text}`,
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
  // Hard stage gate: unlike the shared seed set (which spans all stages), newly
  // discovered companies must match one of the thesis's selected stages. A
  // company whose stage is off-thesis — or can't be pinned to a selected stage
  // at all — is not added. (Sector/fit is still handled softly by grading.)
  if (allowedStages.length > 0) {
    if (!extracted.stage || !allowedStages.includes(extracted.stage)) {
      await log(
        `rejected: stage ${extracted.stage ?? "unknown"} not in thesis stages (${allowedStages.join(", ")})`,
      );
      return null;
    }
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

  // Thin evidence (feed excerpt only): keep at most 2 signals and cap their
  // confidence in code, so the honesty guarantee doesn't rest on the prompt.
  const signals = evidence.thin
    ? extracted.signals.slice(0, 2).map((s) => ({
        ...s,
        confidence: Math.min(s.confidence, THIN_EVIDENCE_MAX_CONFIDENCE),
      }))
    : extracted.signals;

  await log(
    `accepted: ${signals.length} signal(s), sector=${extracted.sector ?? "?"}, stage=${extracted.stage ?? "?"}${evidence.thin ? " (thin evidence)" : ""}`,
  );
  return {
    name: extracted.name,
    website: extracted.website ?? candidate.website,
    sector: extracted.sector,
    stage: extracted.stage,
    source: candidate.source,
    source_url: evidence.url,
    signals,
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
  userId: string,
): Promise<{ inserted: boolean; total: number }> {
  "use step";
  const log = (msg: string) =>
    writeLineInStep("logs:grading", `[${reviewed.name}] ${msg}`);
  const db = getSupabaseAdmin();

  // Last-line dedupe against the live DB (covers races and prior rounds).
  // Scoped to the shared pool + this VC's own companies so another account
  // owning the same company doesn't block this discovery.
  const { data: dupes } = await db
    .from("companies")
    .select("id, name")
    .ilike("name", reviewed.name)
    .or(`user_id.is.null,user_id.eq.${userId}`);
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
      user_id: userId,
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
    stages: thesis.stages,
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
  (industry: string, stage: string) => `${industry} startup ${stage}`,
  (industry: string, stage: string) =>
    `${industry} ${stage} funding announcement`,
  (industry: string) => `new ${industry} company launch`,
  (industry: string, stage: string) => `${stage} ${industry} raise`,
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

/** Thesis slugs make bad search terms ("ai_infra", "series_b") — query with
 * the human labels ("AI infra", "Series B") instead. */
function humanTerm(slug: string, labels: Record<string, string>): string {
  return labels[slug] ?? slug.replace(/_/g, " ");
}

function buildSearchQuery(thesis: Thesis, round: number): string {
  const industries = thesis.industries?.length ? thesis.industries : ["AI"];
  const industry = humanTerm(
    industries[(round - 1) % industries.length],
    INDUSTRY_LABELS,
  );
  // Rotate across the thesis's selected stages so multi-stage theses widen the
  // net over all of them across rounds rather than fixating on one.
  const stages = thesis.stages?.length ? thesis.stages : ["seed"];
  const stage = humanTerm(stages[(round - 1) % stages.length], STAGE_LABELS);

  // Every third round: narrow into a niche vertical rather than the broad term.
  if (round % 3 === 0) {
    const qualifier = NICHE_QUALIFIERS[(round - 1) % NICHE_QUALIFIERS.length];
    return `${industry} ${qualifier} startup`;
  }
  const shape = QUERY_SHAPES[(round - 1) % QUERY_SHAPES.length];
  return shape(industry, stage);
}

/**
 * Funding-news query for the TechCrunch pass — where later-stage (Series A/B)
 * and niche supply actually lives. Rotates industry and stage with the round,
 * alternating query shapes so consecutive rounds surface different articles.
 */
function buildNewsQuery(thesis: Thesis, round: number): string {
  const industries = thesis.industries?.length ? thesis.industries : ["AI"];
  const industry = humanTerm(
    industries[(round - 1) % industries.length],
    INDUSTRY_LABELS,
  );
  const stages = thesis.stages?.length ? thesis.stages : [];
  if (stages.length === 0) return `${industry} startup funding`;
  const stage = humanTerm(stages[(round - 1) % stages.length], STAGE_LABELS);
  return round % 2 === 0 ? `${industry} startup ${stage}` : `${industry} ${stage}`;
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
      const ctx = await loadContext(input.runId, input.userId);
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
        `— round ${round}: scraping ${FIXED_SOURCES.length} fixed sources + search + news (excluding ${excludeKeys.length} already seen) —`,
      );

      // Parallel scraper agents: one per fixed source, plus the query-driven
      // search and funding-news agents (the news pass is what reaches
      // later-stage / niche supply the launch-oriented sources don't carry).
      const batches = await Promise.all([
        ...FIXED_SOURCES.map((key) =>
          scrapeSource(key, thesisSummary, excludeKeys),
        ),
        scrapeSource(
          "search",
          thesisSummary,
          excludeKeys,
          buildSearchQuery(input.thesis, round),
        ),
        scrapeSource(
          "news",
          thesisSummary,
          excludeKeys,
          buildNewsQuery(input.thesis, round),
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
            ctx.existingNames,
            ctx.existingDomains,
            input.thesis.stages ?? [],
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
        const res = await insertAndGrade(
          r,
          input.thesis,
          input.runId,
          found,
          input.userId,
        );
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
