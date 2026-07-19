"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLinkIcon, MailIcon, PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { GMAIL_SCOPE, GOOGLE_OAUTH_QUERY_PARAMS } from "@/lib/gmail-scope";
import {
  DEFAULT_OUTREACH_TEMPLATE,
  TEMPLATE_PLACEHOLDERS,
  validateOutreachTemplate,
} from "@/lib/outreach-template";

/**
 * Tier 5 One-click contact (PLAN.md 5.3/5.4): the button at the bottom of
 * every company report. Click -> a draft appears in the signed-in VC's own
 * Gmail (founder's email pre-filled when one is public), ready to send from
 * Gmail. "Edit draft template" customizes the subject/body used for every
 * future draft, saved to the account. The app never sends anything.
 */

type OutreachState = {
  status: "not_contacted" | "drafted";
  founder_email: string | null;
  drafted_at: string | null;
};

const GMAIL_DRAFTS_URL = "https://mail.google.com/mail/u/0/#drafts";

function TemplateEditor({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [subject, setSubject] = useState(DEFAULT_OUTREACH_TEMPLATE.subject);
  const [body, setBody] = useState(DEFAULT_OUTREACH_TEMPLATE.body);
  const [isCustom, setIsCustom] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/outreach/template")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled || !json?.template) return;
        setSubject(json.template.subject);
        setBody(json.template.body);
        setIsCustom(Boolean(json.is_custom));
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const save = useCallback(async () => {
    const invalid = validateOutreachTemplate({ subject, body });
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/outreach/template", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setIsCustom(true);
        onOpenChange(false);
      } else {
        setError(json.error ?? `Save failed (${res.status}).`);
      }
    } catch {
      setError("Network error — try again.");
    } finally {
      setSaving(false);
    }
  }, [subject, body, onOpenChange]);

  const reset = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/outreach/template", { method: "DELETE" });
      if (res.ok) {
        setSubject(DEFAULT_OUTREACH_TEMPLATE.subject);
        setBody(DEFAULT_OUTREACH_TEMPLATE.body);
        setIsCustom(false);
      }
    } catch {
      setError("Network error — try again.");
    } finally {
      setSaving(false);
    }
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <div className="flex flex-col gap-4">
          <div>
            <DialogTitle>Draft template</DialogTitle>
            <p className="text-muted-foreground mt-1 text-sm">
              Every One-click contact draft uses this template until you change
              it. It saves to your account.
            </p>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Subject
            </span>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={!loaded || saving}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Body
            </span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={!loaded || saving}
              rows={10}
              className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] disabled:opacity-50"
            />
          </label>

          <p className="text-muted-foreground text-xs">
            Placeholders:{" "}
            {TEMPLATE_PLACEHOLDERS.map((p, i) => (
              <span key={p.token}>
                {i > 0 && " · "}
                <code className="bg-muted rounded px-1">{p.token}</code>{" "}
                {p.meaning}
              </span>
            ))}
          </p>

          {error && <p className="text-destructive text-xs">{error}</p>}

          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={reset}
              disabled={!loaded || saving || !isCustom}
              title={isCustom ? undefined : "Already using the default template"}
            >
              Reset to default
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={!loaded || saving}>
                {saving ? "Saving…" : "Save template"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

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
  const [editorOpen, setEditorOpen] = useState(false);

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

  const editTemplateLink = (
    <button
      type="button"
      onClick={() => setEditorOpen(true)}
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 self-start text-xs underline underline-offset-2"
    >
      <PencilIcon className="size-3" />
      Edit draft template
    </button>
  );

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
        {editTemplateLink}
        <TemplateEditor open={editorOpen} onOpenChange={setEditorOpen} />
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
        <>
          <Button size="sm" onClick={contact} disabled={working || state === null}>
            <MailIcon className="size-4" />
            {working ? "Drafting…" : "One-click contact"}
          </Button>
          <p className="text-muted-foreground text-xs">
            Drafts a meeting-request email to the {companyName} founders in your
            own Gmail — nothing is sent until you send it.
          </p>
        </>
      )}
      {editTemplateLink}
      {error && <p className="text-destructive text-xs">{error}</p>}
      <TemplateEditor open={editorOpen} onOpenChange={setEditorOpen} />
    </div>
  );
}
