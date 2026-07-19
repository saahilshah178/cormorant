import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";
import { getActiveThesis, getThesisById } from "@/lib/theses";
import { discoveryWorkflow } from "@/lib/discovery/pipeline";

/**
 * Kick off a discovery run (PLAN.md 4.3/4.4): inserts the discovery_runs row,
 * start()s the durable workflow, and records the Workflow DevKit run id so the
 * UI can reattach to the stream after a page reload. The run itself survives
 * the tab closing — that's the whole point of the durable pipeline. A run finds
 * exactly `targetCount` companies (or stops short only if the sources are truly
 * exhausted).
 *
 * POST body: { targetCount?: number, thesisId?: string }
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  let body: {
    targetCount?: number;
    thesisId?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    // defaults below
  }
  const targetCount = Math.min(
    Math.max(Math.round(body.targetCount ?? 5), 1),
    25,
  );

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
  const { data: activeRuns } = await db
    .from("discovery_runs")
    .select("id")
    .eq("status", "running")
    .limit(1);
  if ((activeRuns ?? []).length > 0) {
    return NextResponse.json(
      { error: "A discovery run is already active. Stop it first." },
      { status: 409 },
    );
  }

  const { data: run, error } = await db
    .from("discovery_runs")
    .insert({
      // `mode` is retained in the schema but always "batch" now that the
      // continuous scanning feature has been removed.
      mode: "batch",
      target_count: targetCount,
      thesis_id: thesis.id,
      status: "running",
    })
    .select("*")
    .single();
  if (error || !run) {
    return NextResponse.json(
      { error: `Could not create run: ${error?.message ?? "no row"}` },
      { status: 500 },
    );
  }

  try {
    const wfRun = await start(discoveryWorkflow, [
      { runId: run.id, targetCount, thesis },
    ]);
    await db
      .from("discovery_runs")
      .update({ workflow_run_id: wfRun.runId })
      .eq("id", run.id);
    return NextResponse.json({
      run: { ...run, workflow_run_id: wfRun.runId },
    });
  } catch (err) {
    await db
      .from("discovery_runs")
      .update({ status: "failed", stopped_at: new Date().toISOString() })
      .eq("id", run.id);
    return NextResponse.json(
      {
        error: `Workflow failed to start: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }
}
