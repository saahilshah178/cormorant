/**
 * The One-click contact draft template (Tier 5). Client-safe module: the
 * template editor dialog and the contact route both import from here.
 *
 * A VC can customize the subject/body once ("Edit draft template") and every
 * future one-click draft uses their version until they change or reset it.
 * Stored per-account in Supabase auth user_metadata under
 * `outreach_template` — deliberately NOT a new table, so no extra manual
 * migration step (see PLAN.md 5.4).
 */

export type OutreachTemplate = {
  subject: string;
  body: string;
};

/** Placeholders swapped in at draft time. Unknown tokens pass through as-is. */
export const TEMPLATE_PLACEHOLDERS = [
  { token: "{{company}}", meaning: "the company's name" },
  { token: "{{fit_reason}}", meaning: "one line of why they fit your active thesis (empty if unscored)" },
  { token: "{{sender}}", meaning: "your email address" },
] as const;

export const DEFAULT_OUTREACH_TEMPLATE: OutreachTemplate = {
  subject: "Meeting request — {{company}}",
  body: [
    "Hi {{company}} team,",
    "",
    "I'm an investor and {{company}} caught my attention. {{fit_reason}}",
    "",
    "Would you be open to a quick intro call? When are you free to meet in the next week or two?",
    "",
    "Best,",
    "{{sender}}",
  ].join("\n"),
};

export const TEMPLATE_LIMITS = { subject: 200, body: 4000 } as const;

/** Returns an error string, or null when the template is valid. */
export function validateOutreachTemplate(tpl: OutreachTemplate): string | null {
  if (!tpl.subject?.trim()) return "Subject can't be empty.";
  if (!tpl.body?.trim()) return "Body can't be empty.";
  if (tpl.subject.length > TEMPLATE_LIMITS.subject)
    return `Subject is over ${TEMPLATE_LIMITS.subject} characters.`;
  if (tpl.body.length > TEMPLATE_LIMITS.body)
    return `Body is over ${TEMPLATE_LIMITS.body} characters.`;
  return null;
}

export function renderOutreachTemplate(
  tpl: OutreachTemplate,
  vars: { company: string; fit_reason: string; sender: string },
): OutreachTemplate {
  const swap = (s: string) =>
    s
      .replaceAll("{{company}}", vars.company)
      .replaceAll("{{fit_reason}}", vars.fit_reason)
      .replaceAll("{{sender}}", vars.sender)
      // an empty fit_reason can leave a dangling space before a newline/end
      .replace(/[ \t]+(?=\n|$)/g, "");
  return { subject: swap(tpl.subject).replace(/\s+/g, " ").trim(), body: swap(tpl.body) };
}
