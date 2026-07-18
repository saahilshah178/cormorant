import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getActiveThesis, getThesisById } from "@/lib/theses";

/**
 * Ranked deal flow for a thesis (PLAN.md 2.5): top companies by fit_score.
 *
 * GET /api/rankings            -> rankings for the ACTIVE thesis (cookie) —
 *                                 the response's thesis_id is the observable
 *                                 proof for the Tier 1 gate (switch the header
 *                                 selector, the id changes).
 * GET /api/rankings?thesisId=X -> rankings for a specific thesis.
 * GET /api/rankings?limit=N    -> top N (default 10).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const thesisId = url.searchParams.get("thesisId");
  const limit = Math.max(
    1,
    Math.min(100, Number(url.searchParams.get("limit") ?? 10)),
  );

  const thesis = thesisId
    ? await getThesisById(thesisId)
    : await getActiveThesis();
  if (!thesis) {
    return NextResponse.json(
      { error: "No thesis found. Create one at /onboarding first." },
      { status: 400 },
    );
  }

  const { data, error } = await getSupabaseAdmin()
    .from("scores")
    .select(
      "fit_score, confidence, fit_rationale, pass_reason, contributing_signal_ids, scored_at, company:companies(id, name, sector, stage, website)",
    )
    .eq("thesis_id", thesis.id)
    .order("fit_score", { ascending: false })
    .limit(limit);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    thesis_id: thesis.id,
    thesis_name: thesis.name,
    count: data?.length ?? 0,
    rankings: data ?? [],
  });
}
