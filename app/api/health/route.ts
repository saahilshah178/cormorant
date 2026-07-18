import { NextResponse } from "next/server";

/**
 * Liveness probe. No external dependencies — always 200 if the app is up.
 * Used as the deploy smoke test (PLAN.md task 0.2 / 0.4).
 */
export function GET() {
  return NextResponse.json({ ok: true });
}
