"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLinkIcon, MailIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { GMAIL_SCOPE, GOOGLE_OAUTH_QUERY_PARAMS } from "@/lib/gmail-scope";

/**
 * Tier 5 One-click contact (PLAN.md 5.3): the button at the bottom of every
 * company report. Click -> a draft appears in the signed-in VC's own Gmail
 * (founder's email pre-filled when one is public), ready to send from Gmail.
 * The app never sends anything.
 */

type OutreachState = {
  status: "not_contacted" | "drafted";
  founder_email: string | null;
  drafted_at: string | null;
};

const GMAIL_DRAFTS_URL = "https://mail.google.com/mail/u/0/#drafts";

export function OneClickContact({
  companyId,
  companyName,
}: {
  companyId: string;
  companyName: string;
}) {
  const [state, setState] = useState<OutreachState | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);

  // Per-company state reset happens by remount: the report renders this
  // component with key={company.id} (the panel swaps companies in place).
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/outreach?companyId=${companyId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!cancelled && json) setState(json);
      })
      .catch(() => {
        if (!cancelled) setState({ status: "not_contacted", founder_email: null, drafted_at: null });
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const contact = useCallback(async () => {
    setWorking(true);
    setError(null);
    setNeedsReauth(false);
    try {
      const res = await fetch("/api/outreach/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setState({
          status: "drafted",
          founder_email: json.founder_email ?? null,
          drafted_at: json.drafted_at ?? null,
        });
      } else if (json.error === "gmail_reauth_required") {
        setNeedsReauth(true);
      } else if (json.error === "gmail_api_disabled") {
        setError(
          "The Gmail API isn't enabled for this app's Google Cloud project yet — enable it, then retry.",
        );
      } else {
        setError(json.error ?? `Draft creation failed (${res.status}).`);
      }
    } catch {
      setError("Network error — try again.");
    } finally {
      setWorking(false);
    }
  }, [companyId]);

  const reconnectGmail = useCallback(() => {
    const supabase = getSupabaseBrowser();
    supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(
          window.location.pathname,
        )}`,
        scopes: GMAIL_SCOPE,
        queryParams: { ...GOOGLE_OAUTH_QUERY_PARAMS },
      },
    });
  }, []);

  if (state?.status === "drafted") {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <MailIcon className="size-4" />
          Drafted — waiting in your Gmail
        </div>
        <p className="text-muted-foreground text-xs">
          {state.founder_email
            ? `Addressed to ${state.founder_email}. Review and send it from Gmail.`
            : "No public founder email was found — open the draft in Gmail and add the recipient."}
        </p>
        <a
          href={GMAIL_DRAFTS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs underline underline-offset-2"
        >
          Open Gmail drafts
          <ExternalLinkIcon className="size-3" />
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {needsReauth ? (
        <>
          <Button size="sm" onClick={reconnectGmail}>
            Connect Gmail to draft outreach
          </Button>
          <p className="text-muted-foreground text-xs">
            Gmail access needs a (re-)grant — you&apos;ll be sent through Google
            sign-in once, then click contact again.
          </p>
        </>
      ) : (
        <Button size="sm" onClick={contact} disabled={working || state === null}>
          <MailIcon className="size-4" />
          {working ? "Drafting…" : "One-click contact"}
        </Button>
      )}
      {!needsReauth && (
        <p className="text-muted-foreground text-xs">
          Drafts a meeting-request email to the {companyName} founders in your
          own Gmail — nothing is sent until you send it.
        </p>
      )}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}
