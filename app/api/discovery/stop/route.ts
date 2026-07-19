import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";

/**
 * Stop a discovery run (PLAN.md 4.3 loop control): flips discovery_runs.status
 * to "stopped". The workflow checks this between rounds (via loadContext) and
 * ends cooperatively at the next round boundary — the in-flight round finishes
 * first so nothing is left half-inserted.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  let body: { runId?: string } = {};
  try {
    body = await req.json();
  } catch {
    // handled below
  }
  if (!body.runId) {
    return NextResponse.json({ error: "runId is required." }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  const { data: run } = await db
    .from("discovery_runs")
    .select("id, status")
    .eq("id", body.runId)
    .maybeSingle();
  if (!run) {
    return NextResponse.json({ error: "Run not found." }, { status: 404 });
  }
  if (run.status !== "running") {
    return NextResponse.json({ ok: true, alreadyStopped: true });
  }

  await db
    .from("discovery_runs")
    .update({ status: "stopped", stopped_at: new Date().toISOString() })
    .eq("id", run.id);

  return NextResponse.json({ ok: true });
}
