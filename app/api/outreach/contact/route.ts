import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";
import { getActiveThesis } from "@/lib/theses";
import { resolveFounderEmail } from "@/lib/founder-email";
import {
  createGmailDraft,
  getGmailAccessToken,
  GmailApiDisabledError,
  GmailAuthError,
} from "@/lib/gmail";

/**
 * POST /api/outreach/contact { companyId } — Tier 5 One-click contact
 * (PLAN.md 5.3): resolve the founder's public email, create a Gmail DRAFT in
 * the signed-in VC's own account (never sends), and record the outreach row.
 * Idempotent: a company already drafted returns the existing draft.
 */
export const maxDuration = 60;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  let companyId: string | undefined;
  try {
    ({ companyId } = await req.json());
  } catch {
    // handled below
  }
  if (!companyId) {
    return NextResponse.json({ error: "companyId is required." }, { status: 400 });
  }

  const db = getSupabaseAdmin();

  // Same visibility rule as every company read (PLAN.md per-user amendment):
  // the shared seed pool (user_id null) or this VC's own discoveries.
  const { data: company } = await db
    .from("companies")
    .select("id, name, website, user_id")
    .eq("id", companyId)
    .maybeSingle();
  if (!company || (company.user_id !== null && company.user_id !== user.id)) {
    return NextResponse.json({ error: "Company not found." }, { status: 404 });
  }

  const { data: existing } = await db
    .from("outreach")
    .select("status, founder_email, gmail_draft_id, drafted_at")
    .eq("company_id", companyId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (existing?.status === "drafted") {
    return NextResponse.json({ ...existing, already_drafted: true });
  }

  // Gmail authorization first — if the VC needs to re-consent, say so before
  // doing any website fetching.
  let accessToken: string;
  try {
    accessToken = await getGmailAccessToken(user.id);
  } catch (err) {
    if (err instanceof GmailAuthError) {
      return NextResponse.json(
        { error: "gmail_reauth_required", message: err.message },
        { status: 401 },
      );
    }
    throw err;
  }

  const founderEmail =
    existing?.founder_email ??
    (await resolveFounderEmail({ name: company.name, website: company.website }));

  // One line of why they're a fit, from this VC's active-thesis score.
  const thesis = await getActiveThesis(user.id);
  let fitLine: string | null = null;
  if (thesis) {
    const { data: score } = await db
      .from("scores")
      .select("fit_rationale")
      .eq("company_id", companyId)
      .eq("thesis_id", thesis.id)
      .maybeSingle();
    fitLine = score?.fit_rationale?.match(/^[^.!?]{10,240}[.!?]/)?.[0]?.trim() ?? null;
  }

  const subject = `Meeting request — ${company.name}`;
  const body = [
    `Hi ${company.name} team,`,
    "",
    `I'm an investor and ${company.name} caught my attention.` +
      (fitLine ? ` ${fitLine}` : ""),
    "",
    "Would you be open to a quick intro call? When are you free to meet in the next week or two?",
    "",
    "Best,",
    user.email ?? "",
  ].join("\n");

  let draftId: string;
  try {
    draftId = await createGmailDraft(accessToken, {
      to: founderEmail,
      subject,
      body,
    });
  } catch (err) {
    if (err instanceof GmailAuthError) {
      return NextResponse.json(
        { error: "gmail_reauth_required", message: err.message },
        { status: 401 },
      );
    }
    if (err instanceof GmailApiDisabledError) {
      return NextResponse.json(
        { error: "gmail_api_disabled", message: err.message },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: `Draft creation failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }

  const draftedAt = new Date().toISOString();
  const { error: upsertError } = await db.from("outreach").upsert(
    {
      company_id: companyId,
      user_id: user.id,
      status: "drafted",
      founder_email: founderEmail,
      gmail_draft_id: draftId,
      drafted_at: draftedAt,
    },
    { onConflict: "company_id,user_id" },
  );
  if (upsertError) {
    // The draft exists in Gmail either way — surface the record failure honestly.
    return NextResponse.json(
      { error: `Draft created (id ${draftId}) but recording it failed: ${upsertError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    status: "drafted",
    founder_email: founderEmail,
    gmail_draft_id: draftId,
    drafted_at: draftedAt,
    email_found: founderEmail !== null,
  });
}
