import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";
import {
  DEFAULT_OUTREACH_TEMPLATE,
  validateOutreachTemplate,
  type OutreachTemplate,
} from "@/lib/outreach-template";

/**
 * The signed-in VC's One-click contact draft template (PLAN.md 5.4).
 * Persisted in auth user_metadata (`outreach_template`) — per-account, no
 * extra table. GET returns the saved template or the default; PUT saves;
 * DELETE resets to the default.
 */

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  const saved = user.user_metadata?.outreach_template as
    | OutreachTemplate
    | null
    | undefined;
  const isCustom = Boolean(saved?.subject && saved?.body);
  return NextResponse.json({
    template: isCustom ? saved : DEFAULT_OUTREACH_TEMPLATE,
    is_custom: isCustom,
  });
}

export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  let subject = "";
  let body = "";
  try {
    ({ subject, body } = await req.json());
  } catch {
    // validated below
  }
  const template: OutreachTemplate = {
    subject: String(subject ?? ""),
    body: String(body ?? ""),
  };
  const invalid = validateOutreachTemplate(template);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 });
  }

  // Spread the existing metadata: safe whether the admin API merges or
  // replaces the user_metadata object.
  const { error } = await getSupabaseAdmin().auth.admin.updateUserById(user.id, {
    user_metadata: { ...user.user_metadata, outreach_template: template },
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ template, is_custom: true });
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  const { error } = await getSupabaseAdmin().auth.admin.updateUserById(user.id, {
    user_metadata: { ...user.user_metadata, outreach_template: null },
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ template: DEFAULT_OUTREACH_TEMPLATE, is_custom: false });
}
