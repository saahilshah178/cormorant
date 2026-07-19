import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";

/**
 * Persistent discovery instructions (PLAN.md §3 / 4.4): free-text guidance
 * the VC gives the agents; every active row is concatenated into the
 * scraper/review/grading prompts on every future round. DELETE deactivates
 * (active=false) rather than removing, preserving the history.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  const { data, error } = await getSupabaseAdmin()
    .from("discovery_instructions")
    .select("*")
    .eq("active", true)
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ instructions: data ?? [] });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  let body: { text?: string } = {};
  try {
    body = await req.json();
  } catch {
    // handled below
  }
  const text = body.text?.trim();
  if (!text) {
    return NextResponse.json({ error: "text is required." }, { status: 400 });
  }
  const { data, error } = await getSupabaseAdmin()
    .from("discovery_instructions")
    .insert({ text, active: true, user_id: user.id })
    .select("*")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ instruction: data });
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  let body: { id?: string } = {};
  try {
    body = await req.json();
  } catch {
    // handled below
  }
  if (!body.id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }
  const { error } = await getSupabaseAdmin()
    .from("discovery_instructions")
    .update({ active: false })
    .eq("id", body.id)
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
