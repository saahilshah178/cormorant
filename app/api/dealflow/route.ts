import { NextResponse } from "next/server";
import { getDealflow } from "@/lib/dealflow";
import { getActiveThesis, getThesisById } from "@/lib/theses";

/**
 * The Tier 3 data layer: everything the deal-flow map AND the ranked board
 * render from, in one payload (companies with scores + signals, plus the
 * shared-signal edges).
 *
 * GET /api/dealflow            -> payload for the ACTIVE thesis (cookie)
 * GET /api/dealflow?thesisId=X -> payload for a specific thesis
 *
 * The client polls this while a scoring run is in flight, so newly scored
 * companies drop onto the map as their rows land.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const thesisId = url.searchParams.get("thesisId");

  const thesis = thesisId
    ? await getThesisById(thesisId)
    : await getActiveThesis();
  if (!thesis) {
    return NextResponse.json(
      { error: "No thesis found. Create one at /onboarding first." },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await getDealflow(thesis));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
