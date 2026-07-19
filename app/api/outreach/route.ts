import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";

/**
 * GET /api/outreach?companyId=... — the signed-in VC's outreach state for one
 * company, so the report can show "Drafted" instead of the button (PLAN.md 5.3).
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const companyId = new URL(req.url).searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "companyId is required." }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  const { data: row } = await db
    .from("outreach")
    .select("status, founder_email, gmail_draft_id, drafted_at")
    .eq("company_id", companyId)
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json(
    row ?? { status: "not_contacted", founder_email: null, gmail_draft_id: null, drafted_at: null },
  );
}
