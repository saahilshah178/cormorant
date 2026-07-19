import { generateText, Output } from "ai";
import { z } from "zod";
import { cheapModel } from "@/lib/models";

/**
 * Best-effort founder/contact email resolution (PLAN.md 5.2): fetch the
 * company's own website (homepage + up to two contact/about/team pages),
 * harvest every address actually present in the HTML, and pick the best one.
 * The hard rule: the result must be an address FOUND on the site — the model
 * only chooses among harvested candidates and code enforces that, so an
 * address is never invented or guessed. Returns null when nothing public
 * exists; the caller creates the draft with To: left blank and says so.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/** Addresses that are never a founder contact (assets, senders, platforms). */
const JUNK_RE =
  /noreply|no-reply|donotreply|do-not-reply|example\.(com|org)|sentry|wixpress|cloudfront|godaddy|@.*\.(png|jpe?g|svg|gif|webp|css|js|woff2?)$|^[0-9a-f]{16,}@/i;

async function fetchPage(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return "";
    return (await res.text()).slice(0, 400_000);
  } catch {
    return "";
  }
}

function harvestEmails(html: string, into: Set<string>) {
  for (const m of html.matchAll(/mailto:([^"'?\s<>&]+)/gi)) {
    const e = decodeURIComponent(m[1]).toLowerCase();
    if (EMAIL_RE.test(e)) into.add(e.match(EMAIL_RE)![0]);
    EMAIL_RE.lastIndex = 0;
  }
  for (const m of html.matchAll(EMAIL_RE)) into.add(m[0].toLowerCase());
}

/** Heuristic order: company-domain addresses first, then friendly local parts. */
function heuristicSort(emails: string[], companyHost: string): string[] {
  const root = companyHost.replace(/^www\./, "");
  const score = (e: string) => {
    let s = 0;
    if (e.endsWith(`@${root}`) || e.endsWith(`.${root}`)) s += 4;
    const local = e.split("@")[0];
    if (/^(hello|contact|founders?|team|info|hi)$/.test(local)) s += 2;
    if (/^(press|support|help|careers|jobs|legal|privacy|abuse)$/.test(local)) s -= 2;
    return s;
  };
  return [...emails].sort((a, b) => score(b) - score(a));
}

export async function resolveFounderEmail(company: {
  name: string;
  website: string | null;
}): Promise<string | null> {
  if (!company.website) return null;
  let base: URL;
  try {
    base = new URL(company.website);
  } catch {
    return null;
  }

  const home = await fetchPage(base.href);
  const candidates = new Set<string>();
  harvestEmails(home, candidates);

  // Follow up to two same-host contact/about/team links off the homepage.
  const followed = new Set<string>();
  for (const m of home.matchAll(/href=["']([^"']+)["']/gi)) {
    if (followed.size >= 2) break;
    const href = m[1];
    if (!/contact|about|team|company/i.test(href)) continue;
    try {
      const u = new URL(href, base);
      if (u.hostname !== base.hostname) continue;
      u.hash = "";
      if (u.href === base.href || followed.has(u.href)) continue;
      followed.add(u.href);
    } catch {
      // unparseable href — skip
    }
  }
  for (const url of followed) harvestEmails(await fetchPage(url), candidates);

  const clean = [...candidates].filter((e) => !JUNK_RE.test(e)).slice(0, 12);
  if (clean.length === 0) return null;

  const ordered = heuristicSort(clean, base.hostname);
  if (ordered.length === 1) return ordered[0];

  // Model tiebreak, constrained to the harvested list — never invents.
  try {
    const result = await generateText({
      model: cheapModel,
      output: Output.object({
        schema: z.object({ email: z.string().nullable() }),
      }),
      prompt:
        `These email addresses were found on ${base.hostname}, the website of the ` +
        `startup "${company.name}". Pick the ONE best address for reaching a ` +
        `founder to set up a meeting (founder/personal > hello@/contact@/team@ > ` +
        `anything else). If none plausibly belongs to this company, return null. ` +
        `You must answer with an address from this exact list or null:\n` +
        ordered.join("\n"),
    });
    const pick = result.output?.email?.toLowerCase() ?? null;
    if (pick && ordered.includes(pick)) return pick;
    if (pick === null && result.output) return null;
  } catch {
    // model unavailable — heuristic winner below
  }
  return ordered[0];
}
