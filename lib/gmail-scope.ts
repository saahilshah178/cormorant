/**
 * Client-safe Google OAuth options for Gmail draft access (Tier 5).
 *
 * gmail.compose lets the app CREATE drafts only — sending stays a human act
 * in Gmail. access_type=offline + prompt=consent makes Google return a
 * refresh token on every grant, which the callback stores so drafts keep
 * working after the ~1h access token expires (when GOOGLE_CLIENT_ID/SECRET
 * are configured for silent refresh; otherwise re-consent re-arms it).
 */
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.compose";

export const GOOGLE_OAUTH_QUERY_PARAMS = {
  access_type: "offline",
  prompt: "consent",
} as const;
