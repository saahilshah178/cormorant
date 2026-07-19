import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Gmail draft plumbing for Tier 5 One-click contact (PLAN.md 5.1/5.3).
 *
 * Token model: the Google provider access token is captured server-side at the
 * OAuth callback (see app/auth/callback/route.ts) and stored in gmail_tokens.
 * Google access tokens live ~1h. If GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are
 * set AND a refresh token was granted (access_type=offline + prompt=consent),
 * expired tokens refresh silently; otherwise the caller surfaces a
 * "reconnect Gmail" re-consent flow. The app only ever CREATES drafts — it
 * never sends mail (gmail.compose scope, drafts.create only).
 */

/** Thrown when the user must re-run Google sign-in to (re)grant Gmail access. */
export class GmailAuthError extends Error {
  constructor(message = "Gmail access has expired — reconnect Gmail.") {
    super(message);
    this.name = "GmailAuthError";
  }
}

/** Thrown when the Gmail API is not enabled in the Google Cloud project. */
export class GmailApiDisabledError extends Error {
  constructor(message = "The Gmail API is not enabled for this Google Cloud project.") {
    super(message);
    this.name = "GmailApiDisabledError";
  }
}

/**
 * Persist provider tokens after an OAuth code exchange. Google only returns a
 * refresh token on consent-prompted offline flows, so a null refreshToken must
 * NOT clobber a previously stored one — PostgREST upsert only touches the
 * columns present in the payload, which is exactly the behavior we need.
 */
export async function saveProviderTokens(
  userId: string,
  accessToken: string,
  refreshToken: string | null,
): Promise<void> {
  const db = getSupabaseAdmin();
  const row: Record<string, string> = {
    user_id: userId,
    access_token: accessToken,
    // Supabase does not expose the provider token's expiry; Google access
    // tokens last 3600s, so record a conservative 55 minutes.
    expires_at: new Date(Date.now() + 55 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (refreshToken) row.refresh_token = refreshToken;
  await db.from("gmail_tokens").upsert(row, { onConflict: "user_id" });
}

/**
 * A currently-valid Gmail access token for this user, refreshing if possible.
 * Throws GmailAuthError when the only fix is re-running the consent flow.
 */
export async function getGmailAccessToken(userId: string): Promise<string> {
  const db = getSupabaseAdmin();
  const { data: row } = await db
    .from("gmail_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (!row) throw new GmailAuthError("No Gmail authorization on file — connect Gmail.");

  const expiresAt = row.expires_at ? Date.parse(row.expires_at) : 0;
  if (row.access_token && expiresAt > Date.now() + 60_000) {
    return row.access_token;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (row.refresh_token && clientId && clientSecret) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: row.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    if (res.ok) {
      const json = (await res.json()) as { access_token: string; expires_in?: number };
      await db
        .from("gmail_tokens")
        .update({
          access_token: json.access_token,
          expires_at: new Date(
            Date.now() + (json.expires_in ?? 3600) * 1000 - 60_000,
          ).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
      return json.access_token;
    }
    // Refresh token revoked/expired — fall through to re-consent.
  }

  throw new GmailAuthError();
}

/**
 * Create a Gmail draft (never sends). `to` may be null — the draft is still
 * created and the VC adds the recipient in Gmail (the honest empty state,
 * PLAN.md 5.2). Returns the Gmail draft id.
 */
export async function createGmailDraft(
  accessToken: string,
  { to, subject, body }: { to: string | null; subject: string; body: string },
): Promise<string> {
  const mime = [
    ...(to ? [`To: ${to}`] : []),
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    body,
  ].join("\r\n");
  const raw = Buffer.from(mime, "utf8").toString("base64url");

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: { raw } }),
  });

  if (res.ok) {
    const json = (await res.json()) as { id: string };
    return json.id;
  }

  const text = await res.text().catch(() => "");
  if (res.status === 401) throw new GmailAuthError();
  if (res.status === 403) {
    if (/accessNotConfigured|SERVICE_DISABLED|has not been used/i.test(text)) {
      throw new GmailApiDisabledError();
    }
    // Insufficient scope (signed in before the gmail.compose scope existed).
    throw new GmailAuthError(
      "The Google session lacks Gmail permission — reconnect Gmail.",
    );
  }
  throw new Error(`Gmail drafts.create failed: ${res.status} ${text.slice(0, 200)}`);
}
