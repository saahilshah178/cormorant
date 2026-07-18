import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getActiveThesis, getThesisById } from "@/lib/theses";
import { getCurrentUser } from "@/lib/auth";
import {
  scoreCompany,
  type CompanyRow,
  type SignalRow,
} from "@/lib/scoring";

/**
 * Batch scoring (PLAN.md 2.4/2.5): scores every seed company against a
 * thesis, persisting one `scores` row per (company, thesis).
 *
 * POST body (all optional): { "thesisId": "...", "force": true, "companies": ["Name"] }
 * - thesisId omitted -> the ACTIVE thesis (cookie) — this is the downstream
 *   call that proves the header selector works (PLAN.md 1.2).
 * - force omitted    -> companies already scored for this thesis are reused
 *   (cached), so switching back to an already-scored thesis is instant.
 * - companies        -> restrict to these company names (sample runs, 2.3).
 */

export const maxDuration = 300;

const CONCURRENCY = 4;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  let body: { thesisId?: string; force?: boolean; companies?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }

  const thesis = body.thesisId
    ? await getThesisById(body.thesisId, user.id)
    : await getActiveThesis(user.id);
  if (!thesis) {
    return NextResponse.json(
      { error: "No thesis found. Create one at /onboarding first." },
      { status: 400 },
    );
  }

  const db = getSupabaseAdmin();

  const [companiesRes, signalsRes, scoresRes] = await Promise.all([
    db
      .from("companies")
      .select("id, name, website, github_url, sector, stage, source")
      .neq("source", "tier0-db-check"),
    db.from("signals").select("id, company_id, kind, value, source_url, confidence"),
    db.from("scores").select("company_id").eq("thesis_id", thesis.id),
  ]);
  for (const res of [companiesRes, signalsRes, scoresRes]) {
    if (res.error) {
      return NextResponse.json({ error: res.error.message }, { status: 500 });
    }
  }

  const companies = (companiesRes.data ?? []) as (CompanyRow & {
    source: string | null;
  })[];
  const signalsByCompany = new Map<string, SignalRow[]>();
  for (const s of signalsRes.data ?? []) {
    const list = signalsByCompany.get(s.company_id) ?? [];
    list.push(s as SignalRow);
    signalsByCompany.set(s.company_id, list);
  }
  const alreadyScored = new Set(
    (scoresRes.data ?? []).map((r) => r.company_id as string),
  );

  const nameFilter = body.companies?.length
    ? new Set(body.companies.map((n) => n.toLowerCase()))
    : null;
  const inScope = companies.filter(
    (c) => !nameFilter || nameFilter.has(c.name.toLowerCase()),
  );
  const todo = inScope.filter((c) => {
    const signals = signalsByCompany.get(c.id) ?? [];
    if (signals.length === 0) return false; // no score without signals
    return body.force ? true : !alreadyScored.has(c.id);
  });
  const skippedNoSignals = inScope.filter(
    (c) => (signalsByCompany.get(c.id) ?? []).length === 0,
  ).length;

  const startedAt = Date.now();
  let scored = 0;
  const failed: { company: string; error: string }[] = [];

  // Simple worker pool: CONCURRENCY workers pull from a shared queue.
  const queue = [...todo];
  async function worker() {
    for (;;) {
      const company = queue.shift();
      if (!company) return;
      const signals = signalsByCompany.get(company.id) ?? [];
      try {
        const result = await scoreCompany(thesis!, company, signals);
        const { error } = await db.from("scores").upsert(
          {
            company_id: company.id,
            thesis_id: thesis!.id,
            fit_score: result.fit_score,
            confidence: result.confidence,
            fit_rationale: result.fit_rationale,
            pass_reason: result.pass_reason,
            contributing_signal_ids: result.contributing_signal_ids,
            scored_at: new Date().toISOString(),
          },
          { onConflict: "company_id,thesis_id" },
        );
        if (error) throw new Error(`persist failed: ${error.message}`);
        scored++;
      } catch (err) {
        failed.push({
          company: company.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker),
  );

  return NextResponse.json({
    thesis_id: thesis.id,
    thesis_name: thesis.name,
    companies: inScope.length,
    scored,
    reused_cached: inScope.length - todo.length - skippedNoSignals,
    skipped_no_signals: skippedNoSignals,
    failed,
    duration_ms: Date.now() - startedAt,
  });
}
