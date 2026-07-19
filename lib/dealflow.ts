import { getSupabaseAdmin } from "@/lib/supabase";
import type { Thesis } from "@/lib/thesis-schema";

/**
 * Deal-flow data assembly (PLAN.md Tier 3): one payload that both the map and
 * the board render from. Companies come back only if they have a score for
 * the thesis AND that score's signals — no score without its signals.
 *
 * Edges implement PLAN.md §6 "companies sharing a signal": a shared investor
 * or accelerator mentioned in signal text, or the same sector (adjacent
 * market). Groups bigger than 5 connect as a ring with chords instead of a
 * full clique so the map stays readable (a 14-company YC batch would
 * otherwise be 91 edges).
 */

export type DealflowSignal = {
  id: string;
  kind: string;
  value: string | null;
  source_url: string | null;
  confidence: number | null;
};

export type DealflowCompany = {
  id: string;
  name: string;
  website: string | null;
  sector: string | null;
  stage: string | null;
  source: string | null;
  fit_score: number;
  confidence: number;
  fit_rationale: string;
  pass_reason: string;
  contributing_signal_ids: string[];
  scored_at: string;
  signals: DealflowSignal[];
};

export type DealflowEdge = {
  source: string;
  target: string;
  label: string;
  kind: "shared_signal" | "sector";
};

export type DealflowPayload = {
  thesis: { id: string; name: string };
  total_companies: number;
  companies: DealflowCompany[];
  edges: DealflowEdge[];
};

/**
 * Investors/accelerators worth an edge, matched against signal text. Aliases
 * collapse into one canonical label so "YC" and "Y Combinator" connect.
 */
const SHARED_ENTITIES: { label: string; pattern: RegExp }[] = [
  { label: "Y Combinator", pattern: /\b(Y Combinator|YC)\b/ },
  { label: "Andreessen Horowitz", pattern: /\b(Andreessen|a16z)\b/i },
  { label: "Benchmark", pattern: /\bBenchmark\b/ },
  { label: "Sequoia", pattern: /\bSequoia\b/i },
  { label: "Accel", pattern: /\bAccel\b/ },
  { label: "General Catalyst", pattern: /\bGeneral Catalyst\b/i },
  { label: "Khosla Ventures", pattern: /\bKhosla\b/i },
  { label: "Felicis", pattern: /\bFelicis\b/i },
  { label: "Menlo Ventures", pattern: /\bMenlo Ventures?\b/i },
  { label: "Initialized", pattern: /\bInitialized\b/i },
  { label: "Founders Fund", pattern: /\bFounders Fund\b/i },
  { label: "Greylock", pattern: /\bGreylock\b/i },
  { label: "Lightspeed", pattern: /\bLightspeed\b/i },
  { label: "Techstars", pattern: /\bTechstars\b/i },
];

/** Connect a group: full clique when small, ring + chords when big. */
function groupEdges(
  ids: string[],
  label: string,
  kind: DealflowEdge["kind"],
): DealflowEdge[] {
  const sorted = [...ids].sort();
  const edges: DealflowEdge[] = [];
  if (sorted.length <= 5) {
    for (let i = 0; i < sorted.length; i++)
      for (let j = i + 1; j < sorted.length; j++)
        edges.push({ source: sorted[i], target: sorted[j], label, kind });
  } else {
    for (let i = 0; i < sorted.length; i++) {
      edges.push({
        source: sorted[i],
        target: sorted[(i + 1) % sorted.length],
        label,
        kind,
      });
      edges.push({
        source: sorted[i],
        target: sorted[(i + 2) % sorted.length],
        label,
        kind,
      });
    }
  }
  return edges;
}

function buildEdges(companies: DealflowCompany[]): DealflowEdge[] {
  const byEntity = new Map<string, string[]>();
  for (const company of companies) {
    const text = company.signals.map((s) => s.value ?? "").join("\n");
    for (const { label, pattern } of SHARED_ENTITIES) {
      if (pattern.test(text)) {
        byEntity.set(label, [...(byEntity.get(label) ?? []), company.id]);
      }
    }
  }

  const bySector = new Map<string, string[]>();
  for (const company of companies) {
    if (!company.sector) continue;
    bySector.set(company.sector, [
      ...(bySector.get(company.sector) ?? []),
      company.id,
    ]);
  }

  // Shared-investor edges win over sector edges for the same pair.
  const seen = new Set<string>();
  const edges: DealflowEdge[] = [];
  const push = (edge: DealflowEdge) => {
    const key = [edge.source, edge.target].sort().join("|");
    if (seen.has(key)) return;
    seen.add(key);
    edges.push(edge);
  };

  for (const [label, ids] of byEntity) {
    if (ids.length < 2) continue;
    for (const edge of groupEdges(ids, `Shared: ${label}`, "shared_signal"))
      push(edge);
  }
  for (const [sector, ids] of bySector) {
    if (ids.length < 2) continue;
    for (const edge of groupEdges(ids, `Adjacent market: ${sector}`, "sector"))
      push(edge);
  }
  return edges;
}

export async function getDealflow(
  thesis: Thesis,
  userId: string,
): Promise<DealflowPayload> {
  const db = getSupabaseAdmin();

  const [scoresRes, countRes] = await Promise.all([
    db
      .from("scores")
      .select(
        "fit_score, confidence, fit_rationale, pass_reason, contributing_signal_ids, scored_at, company:companies(id, name, website, sector, stage, source, signals(id, kind, value, source_url, confidence))",
      )
      .eq("thesis_id", thesis.id)
      .order("fit_score", { ascending: false }),
    // Total pool this VC could score: shared seed set (user_id IS NULL) plus
    // their own discovered companies.
    db
      .from("companies")
      .select("id", { count: "exact", head: true })
      .neq("source", "tier0-db-check")
      .or(`user_id.is.null,user_id.eq.${userId}`),
  ]);
  if (scoresRes.error)
    throw new Error(`getDealflow scores failed: ${scoresRes.error.message}`);
  if (countRes.error)
    throw new Error(`getDealflow count failed: ${countRes.error.message}`);

  const companies: DealflowCompany[] = [];
  for (const row of scoresRes.data ?? []) {
    // PostgREST types one-to-one embeds as an array; normalize either shape.
    const company = Array.isArray(row.company) ? row.company[0] : row.company;
    if (!company || company.source === "tier0-db-check") continue;
    companies.push({
      id: company.id,
      name: company.name,
      website: company.website,
      sector: company.sector,
      stage: company.stage,
      source: company.source,
      fit_score: row.fit_score,
      confidence: row.confidence,
      fit_rationale: row.fit_rationale,
      pass_reason: row.pass_reason,
      contributing_signal_ids: row.contributing_signal_ids ?? [],
      scored_at: row.scored_at,
      signals: (company.signals ?? []) as DealflowSignal[],
    });
  }

  return {
    thesis: { id: thesis.id, name: thesis.name },
    total_companies: countRes.count ?? 0,
    companies,
    edges: buildEdges(companies),
  };
}
