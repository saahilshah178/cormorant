import { NextResponse } from "next/server";
import { getRun } from "workflow/api";
import { getCurrentUser } from "@/lib/auth";

/**
 * Live agent-activity stream (PLAN.md 4.4): proxies a Workflow DevKit run
 * stream to the browser. `namespace` selects the per-agent log channel
 * (logs:scraper / logs:review / logs:grading); omitted = the default stream
 * ("company inserted" events). Streams replay from the start on each request,
 * which is exactly what reattach-after-reload needs.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const workflowRunId = searchParams.get("workflowRunId");
  const namespace = searchParams.get("namespace") ?? undefined;
  if (!workflowRunId) {
    return NextResponse.json(
      { error: "workflowRunId is required." },
      { status: 400 },
    );
  }

  try {
    const run = getRun(workflowRunId);
    const readable = run
      .getReadable<string>({ namespace })
      .pipeThrough(new TextEncoderStream());
    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
