import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * TEMPORARY Supabase round-trip check (PLAN.md task 0.3).
 *
 * Inserts one sentinel `companies` row, reads it back, and returns it — proving
 * the schema exists and server-side DB access works. Idempotent: it clears any
 * prior sentinel rows first, so re-running never piles up duplicates, and it
 * leaves exactly one row behind so it is visible in the Supabase dashboard.
 *
 * Delete this route once Tier 0 is verified.
 */
const SENTINEL_SOURCE = "tier0-db-check";

export async function GET() {
  try {
    const db = getSupabaseAdmin();

    // Clean up prior sentinel rows so re-runs stay idempotent.
    await db.from("companies").delete().eq("source", SENTINEL_SOURCE);

    const { data: inserted, error: insertError } = await db
      .from("companies")
      .insert({
        name: "DB Check Co",
        website: "https://example.com",
        sector: "diagnostics",
        stage: "pre-seed",
        source: SENTINEL_SOURCE,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    const { data: readBack, error: readError } = await db
      .from("companies")
      .select("*")
      .eq("id", inserted.id)
      .single();

    if (readError) throw readError;

    return NextResponse.json({
      ok: true,
      roundTrip: readBack,
      note: "Insert + read-back succeeded. This row is left in the DB so you can see it in the Supabase dashboard; re-running replaces it.",
    });
  } catch (err) {
    // Supabase/Postgrest errors are plain objects (not Error instances), so
    // surface their fields directly instead of stringifying to "[object Object]".
    const detail =
      err instanceof Error
        ? { message: err.message }
        : typeof err === "object" && err !== null
          ? (err as Record<string, unknown>)
          : { message: String(err) };
    return NextResponse.json(
      {
        ok: false,
        error: detail,
        hint: "Ensure SUPABASE_URL + SUPABASE_SECRET_KEY are set and the migration has been applied (supabase db push).",
      },
      { status: 500 },
    );
  }
}
