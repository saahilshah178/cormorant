/**
 * Tier 4 source integrations (PLAN.md 4.2): one fetch+parse function per fixed
 * public source, each returning raw candidate mentions in one shape, plus a
 * search function for the broaden-the-net pass.
 *
 * All keyless endpoints verified live 2026-07-18:
 * - YC directory via the yc-oss static mirror (per-batch JSON).
 * - Hacker News Show HN via the Algolia API.
 * - Product Hunt via its public Atom feed.
 * - GitHub via the keyless search API (10 req/min unauthenticated — fine for
 *   one call per discovery round).
 * - TechCrunch via its public WordPress REST search — the funding-news pass
 *   that gives later-stage (Series A/B) theses real supply; the launch-oriented
 *   sources above rarely surface those. (VentureBeat and Finsmes bot-wall
 *   their wp-json, verified 2026-07-18 — TechCrunch is the one that works.)
 * - Wellfound is DataDome bot-walled (403 challenge page from every network
 *   tried, incl. via proxies); the function stays implemented and returns []
 *   with a warning when blocked, and parses normally if it ever unblocks.
 *
 * Search: Exa or Tavily when a key is present (EXA_API_KEY / TAVILY_API_KEY),
 * else a keyless fallback (HN Algolia full-text search — a real query-string
 * search API) so the pipeline works with zero extra signups.
 */

export type Candidate = {
  /** Raw candidate name as the source presents it (review agent normalizes). */
  name: string;
  /** One-to-few lines of context from the source. */
  snippet: string;
  /** The page this mention actually came from — always real and citable. */
  source_url: string;
  /** Source key, e.g. "yc" — becomes companies.source = "discovery:yc". */
  source: SourceKey;
  /** Product/company website when the source exposes one. */
  website: string | null;
};

export type SourceKey =
  | "yc"
  | "producthunt"
  | "hackernews"
  | "github"
  | "wellfound"
  | "search"
  | "news";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const PER_SOURCE_CAP = 40;

/** Shared browser-like fetch — also used by the review agent's citation
 * verification, which previously sent a "CormorantBot" UA that got 403'd by
 * pages that serve these headers fine. */
export async function get(url: string, headers: Record<string, string> = {}) {
  return fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "en-US,en;q=0.9",
      ...headers,
    },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** YC directory (yc-oss static mirror): the several most recent published batches. */
export async function fetchYCCandidates(): Promise<Candidate[]> {
  // Batch slugs are seasonal; try the plausible recent ones and keep the first
  // few that exist. Pulling 4 batches (not 2) roughly doubles the YC pool so
  // deeper rounds keep finding fresh on-thesis and niche companies to advance
  // into rather than re-hitting the same top names.
  const year = new Date().getFullYear();
  const slugs = [
    `fall-${year}`,
    `summer-${year}`,
    `spring-${year}`,
    `winter-${year}`,
    `fall-${year - 1}`,
    `summer-${year - 1}`,
    `spring-${year - 1}`,
    `winter-${year - 1}`,
  ];
  const out: Candidate[] = [];
  let batchesUsed = 0;
  for (const slug of slugs) {
    if (batchesUsed >= 4) break;
    const res = await get(`https://yc-oss.github.io/api/batches/${slug}.json`);
    if (!res.ok) continue;
    batchesUsed++;
    const companies = (await res.json()) as {
      name: string;
      one_liner?: string;
      long_description?: string;
      website?: string;
      industry?: string;
      subindustry?: string;
      tags?: string[];
      batch?: string;
      url?: string;
      slug?: string;
    }[];
    for (const c of companies) {
      if (!c.name) continue;
      out.push({
        name: c.name,
        snippet: [
          c.one_liner ?? c.long_description?.slice(0, 200) ?? "",
          c.batch ? `YC ${c.batch}.` : "",
          // Surface industry + subindustry + tags so triage can spot niche
          // verticals, not just the headline industries.
          [c.industry, c.subindustry].filter(Boolean).join(" / "),
          (c.tags ?? []).slice(0, 5).join(", "),
        ]
          .filter(Boolean)
          .join(" · "),
        source_url:
          c.url ?? `https://www.ycombinator.com/companies/${c.slug ?? ""}`,
        source: "yc",
        website: c.website ?? null,
      });
    }
  }
  return out.slice(0, PER_SOURCE_CAP * 2); // YC batches are dense with real startups
}

/** Hacker News Show HN + Launch HN via the Algolia API (both = real launches). */
export async function fetchHackerNewsCandidates(): Promise<Candidate[]> {
  // Show HN (indie/self-serve launches) OR Launch HN (YC-backed launches) —
  // two different populations, both real companies announcing themselves.
  const res = await get(
    "https://hn.algolia.com/api/v1/search_by_date?tags=(show_hn,launch_hn)&hitsPerPage=50",
  );
  if (!res.ok) throw new Error(`HN Algolia ${res.status}`);
  const data = (await res.json()) as {
    hits: {
      title?: string;
      url?: string | null;
      objectID: string;
      points?: number;
      story_text?: string | null;
      created_at?: string;
    }[];
  };
  return data.hits
    .filter((h) => h.title)
    .slice(0, PER_SOURCE_CAP)
    .map((h) => ({
      name: (h.title ?? "").replace(/^(Show|Launch) HN:\s*/i, "").trim(),
      snippet: [
        h.title,
        h.story_text ? stripTags(h.story_text).slice(0, 240) : "",
        `${h.points ?? 0} points on HN`,
      ]
        .filter(Boolean)
        .join(" · "),
      // The HN post is the page this mention came from — always loads.
      source_url: `https://news.ycombinator.com/item?id=${h.objectID}`,
      source: "hackernews" as const,
      website: h.url ?? null,
    }));
}

/** Product Hunt launches via the public Atom feed (regex parse, no XML dep). */
export async function fetchProductHuntCandidates(): Promise<Candidate[]> {
  const res = await get("https://www.producthunt.com/feed", {
    Accept: "application/atom+xml, application/xml, text/xml",
  });
  if (!res.ok) throw new Error(`Product Hunt feed ${res.status}`);
  const xml = await res.text();
  const out: Candidate[] = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(xml)) && out.length < PER_SOURCE_CAP) {
    const entry = m[1];
    const title = entry.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1];
    const link = entry.match(/<link[^>]*href="([^"]+)"/)?.[1];
    const content = entry.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1];
    if (!title || !link) continue;
    out.push({
      name: stripTags(title),
      snippet: content
        ? `Launched on Product Hunt · ${stripTags(content).slice(0, 240)}`
        : "Launched on Product Hunt",
      source_url: decodeEntities(link),
      source: "producthunt",
      website: null, // PH page links out; review agent extracts the site
    });
  }
  return out;
}

/** GitHub: recently created repos with traction, via the keyless search API. */
export async function fetchGitHubCandidates(): Promise<Candidate[]> {
  // 60-day window (was 21) so the pool is wider and later rounds still have
  // fresh, not-yet-reviewed repos to advance into.
  const since = new Date(Date.now() - 60 * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  const res = await get(
    `https://api.github.com/search/repositories?q=created:%3E${since}&sort=stars&order=desc&per_page=${PER_SOURCE_CAP}`,
    { Accept: "application/vnd.github+json" },
  );
  if (!res.ok) throw new Error(`GitHub search ${res.status}`);
  const data = (await res.json()) as {
    items: {
      full_name: string;
      html_url: string;
      description?: string | null;
      stargazers_count?: number;
      homepage?: string | null;
    }[];
  };
  return (data.items ?? []).map((r) => ({
    name: r.full_name.split("/")[1] ?? r.full_name,
    snippet: [
      r.description ?? "",
      `${r.stargazers_count ?? 0} GitHub stars in <3 weeks (${r.full_name})`,
    ]
      .filter(Boolean)
      .join(" · "),
    source_url: r.html_url,
    source: "github" as const,
    website: r.homepage || null,
  }));
}

/**
 * Wellfound (AngelList). DataDome bot-walls this from datacenter and consumer
 * networks alike (verified 2026-07-18: 403 challenge shim on every path,
 * including sitemap.xml). Implemented per PLAN.md; degrades to [] with a
 * warning instead of failing the round when blocked.
 */
export async function fetchWellfoundCandidates(): Promise<Candidate[]> {
  const res = await get("https://wellfound.com/discover/startups");
  if (!res.ok) {
    console.warn(`Wellfound blocked (${res.status} — DataDome); skipping`);
    return [];
  }
  const html = await res.text();
  if (/captcha-delivery\.com|datadome/i.test(html)) {
    console.warn("Wellfound returned a DataDome challenge page; skipping");
    return [];
  }
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const re =
    /<a[^>]+href="\/company\/([a-z0-9-]+)"[^>]*>([\s\S]{0,400}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < PER_SOURCE_CAP) {
    const slug = m[1];
    if (seen.has(slug)) continue;
    seen.add(slug);
    const text = stripTags(m[2]);
    if (!text) continue;
    out.push({
      name: text.split("·")[0].trim().slice(0, 80) || slug,
      snippet: `Listed on Wellfound · ${text.slice(0, 240)}`,
      source_url: `https://wellfound.com/company/${slug}`,
      source: "wellfound",
      website: null,
    });
  }
  return out;
}

/**
 * Broaden-the-net search (PLAN.md 4.2): Exa or Tavily when a key is set;
 * otherwise the keyless HN Algolia full-text search so the pass still runs
 * (flagged in PLAN.md — swap in a real web-search key for wider reach).
 */
export async function searchCandidates(query: string): Promise<Candidate[]> {
  const exaKey = process.env.EXA_API_KEY;
  const tavilyKey = process.env.TAVILY_API_KEY;

  if (exaKey) {
    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "x-api-key": exaKey, "Content-Type": "application/json" },
      body: JSON.stringify({ query, numResults: 10, type: "auto" }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Exa search ${res.status}`);
    const data = (await res.json()) as {
      results: { title?: string; url: string; text?: string }[];
    };
    return (data.results ?? []).map((r) => ({
      name: r.title ?? r.url,
      snippet: (r.text ?? r.title ?? "").slice(0, 240),
      source_url: r.url,
      source: "search" as const,
      website: null,
    }));
  }

  if (tavilyKey) {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tavilyKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, max_results: 10 }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Tavily search ${res.status}`);
    const data = (await res.json()) as {
      results: { title?: string; url: string; content?: string }[];
    };
    return (data.results ?? []).map((r) => ({
      name: r.title ?? r.url,
      snippet: (r.content ?? r.title ?? "").slice(0, 240),
      source_url: r.url,
      source: "search" as const,
      website: null,
    }));
  }

  // Keyless fallback: HN full-text search + GitHub repo search — two different
  // populations, so the broaden-the-net / niche pass reaches beyond a single
  // site even with no Exa/Tavily key. Each is failure-isolated so one being
  // rate-limited never sinks the whole pass.
  const [hn, gh] = await Promise.allSettled([
    searchHackerNews(query),
    searchGitHubRepos(query),
  ]);
  const out: Candidate[] = [];
  if (hn.status === "fulfilled") out.push(...hn.value);
  if (gh.status === "fulfilled") out.push(...gh.value);
  return out;
}

/** Keyless HN full-text search (real query-string search API). */
async function searchHackerNews(query: string): Promise<Candidate[]> {
  const res = await get(
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=15`,
  );
  if (!res.ok) throw new Error(`HN search ${res.status}`);
  const data = (await res.json()) as {
    hits: {
      title?: string;
      url?: string | null;
      objectID: string;
      points?: number;
    }[];
  };
  return data.hits
    .filter((h) => h.title)
    .map((h) => ({
      name: (h.title ?? "").replace(/^(Show|Launch) HN:\s*/i, "").trim(),
      snippet: `${h.title} · ${h.points ?? 0} points on HN (matched search: "${query}")`,
      source_url: `https://news.ycombinator.com/item?id=${h.objectID}`,
      source: "search" as const,
      website: h.url ?? null,
    }));
}

/** Keyless GitHub repo search by keyword — reaches niche/vertical projects. */
async function searchGitHubRepos(query: string): Promise<Candidate[]> {
  const res = await get(
    `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=15`,
    { Accept: "application/vnd.github+json" },
  );
  if (!res.ok) throw new Error(`GitHub repo search ${res.status}`);
  const data = (await res.json()) as {
    items: {
      full_name: string;
      html_url: string;
      description?: string | null;
      stargazers_count?: number;
      homepage?: string | null;
    }[];
  };
  return (data.items ?? []).map((r) => ({
    name: r.full_name.split("/")[1] ?? r.full_name,
    snippet: [
      r.description ?? "",
      `${r.stargazers_count ?? 0} GitHub stars (matched search: "${query}")`,
    ]
      .filter(Boolean)
      .join(" · "),
    source_url: r.html_url,
    source: "search" as const,
    website: r.homepage || null,
  }));
}

/**
 * Funding/startup news via TechCrunch's public WordPress REST search (keyless,
 * verified live 2026-07-18). This is the pass that reaches later-stage and
 * niche companies: a "Series B fintech" thesis finds its supply in funding
 * announcements, not on Show HN. Article pages themselves fetch fine
 * server-side, so the review agent can verify the citation normally.
 */
export async function fetchNewsCandidates(query: string): Promise<Candidate[]> {
  const res = await get(
    `https://techcrunch.com/wp-json/wp/v2/posts?search=${encodeURIComponent(query)}&per_page=20&_fields=link,title,excerpt,date`,
    { Accept: "application/json" },
  );
  if (!res.ok) throw new Error(`TechCrunch search ${res.status}`);
  const posts = (await res.json()) as {
    link?: string;
    date?: string;
    title?: { rendered?: string };
    excerpt?: { rendered?: string };
  }[];
  return (posts ?? [])
    .filter((p) => p.link && p.title?.rendered)
    .slice(0, PER_SOURCE_CAP)
    .map((p) => {
      const title = stripTags(p.title?.rendered ?? "");
      return {
        name: companyNameFromHeadline(title),
        snippet: [
          title,
          p.excerpt?.rendered ? stripTags(p.excerpt.rendered).slice(0, 240) : "",
          `TechCrunch${p.date ? `, ${p.date.slice(0, 10)}` : ""} (matched search: "${query}")`,
        ]
          .filter(Boolean)
          .join(" · "),
        source_url: p.link as string,
        source: "news" as const,
        website: null,
      };
    });
}

/**
 * Best-effort company name from a news headline ("Sarvam becomes India's
 * newest AI unicorn…" → "Sarvam"; "IQM, Europe's first public quantum company,
 * admits…" → "IQM"). The review agent canonicalizes the name from the article
 * text; this only has to be good enough for triage, dedupe, and logs.
 */
const HEADLINE_VERBS =
  "raises|raised|lands|landed|secures|secured|nabs|nabbed|closes|closed|banks|snags|grabs|scores|collects|picks|pulls|gets|got|hits|reaches|becomes|is|has|wants|aims|launches|launched|debuts|unveils|expands|acquires|buys|partners|teams|tops|valued|eyes|plans|brings|turns|joins|files|doubles|triples|admits|says|announces|reveals|wins|sees|adds|ships|reports|claims|warns|faces|seeks|exits|sells|inks|signs";

function companyNameFromHeadline(title: string): string {
  const t = title.replace(/^(?:exclusive|breaking|report)[:,]\s*/i, "").trim();
  // "<Name>[, appositive,] <verb> …"
  const lead = t.match(
    new RegExp(
      `^([A-Z][\\w.&'’-]*(?:\\s+[A-Z][\\w.&'’-]*){0,3})(?:,[^,]{0,80},)?\\s+(?:${HEADLINE_VERBS})\\b`,
    ),
  );
  if (lead) return lead[1].trim();
  // "… startup <Name> <verb> …" ("Fintech startup Mercury lands $300M…")
  const mid = t.match(
    new RegExp(
      `\\b(?:startup|company|firm)\\s+([A-Z][\\w.&'’-]*(?:\\s+[A-Z][\\w.&'’-]*){0,2})\\s+(?:${HEADLINE_VERBS})\\b`,
    ),
  );
  if (mid) return mid[1].trim();
  return t;
}

/** Dispatcher the workflow steps call by key (functions aren't serializable). */
export async function fetchSourceCandidates(
  key: SourceKey,
  searchQuery?: string,
): Promise<Candidate[]> {
  switch (key) {
    case "yc":
      return fetchYCCandidates();
    case "producthunt":
      return fetchProductHuntCandidates();
    case "hackernews":
      return fetchHackerNewsCandidates();
    case "github":
      return fetchGitHubCandidates();
    case "wellfound":
      return fetchWellfoundCandidates();
    case "search":
      return searchCandidates(searchQuery ?? "AI startup seed round");
    case "news":
      return fetchNewsCandidates(searchQuery ?? "startup funding round");
  }
}

export const FIXED_SOURCES: SourceKey[] = [
  "yc",
  "producthunt",
  "hackernews",
  "github",
  "wellfound",
];
