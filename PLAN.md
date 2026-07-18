# Cormorant — Build Plan

An AI venture-capital operating system that discovers startups, scores them against a
VC's stated investment thesis with traceable evidence, and supports rapid, evidence-backed
decisions. Built for Hack-Nation's Global AI Hackathon, Challenge 2 (The VC Brain,
sponsored by Maschmeyer Group).

This file is the single source of truth for the build. Both builders read it before writing
code. It is also part of the repo's pitch surface: a judge who opens the repo should be able
to understand the whole product from this file. Keep it clean. Delete abandoned tasks rather
than leaving them half-written.

---

## 1. What we are building (and what we are deliberately not)

The product is the VC side only. One customer: the investor. The output that wins this track
is a scored, ranked deal-flow view where every score is traceable to cited signals, scored
against the VC's own thesis, and honest about its own confidence.

The angle that separates us from the crowd: we do not score for hype. Every other team builds
"rank startups by how promising they look." We score fit-to-thesis and we surface the
falsifiable reason to pass. A VC trusts a system that can articulate the bear case. That is
the demo moment.

The signature visual is a live deal-flow map: nodes are discovered companies, positioned by
fit to the active thesis (closer to center = higher fit), sized by confidence, colored by
sector, with edges connecting companies that share a signal (same investor, same accelerator,
adjacent market). As the agent discovers and scores during the demo, nodes drop in and settle.

### Explicitly out of scope (do not build)
- Any founder-facing product: no founder application portal, no auto-apply-from-GitHub flow,
  no founder onboarding. One customer only.
- Multi-tenant auth, billing, teams, roles.
- Anything that sends real outbound messages to real people during judging.

### Tiered scope — this is the most important section
Build strictly in tier order. Do not start a tier until the previous one works end to end and
is committed. The outreach tier is real product value but carries zero judging weight, so it
is the first thing cut if we are behind. Agreed rule: if the core (Tiers 0–3) is not done and
demo-clean with real buffer before the video, Tier 5 does not get built. No exceptions,
no "just one more hour."

- Tier 0 — Skeleton that deploys. (gate: live URL streams a response)
- Tier 1 — Thesis onboarding. (gate: a thesis object is saved and drives scoring)
- Tier 2 — Scoring engine over a pre-indexed company set, with traceable signals + citations.
- Tier 3 — The deal-flow map + company report drill-down. (this is the demo)
- Tier 4 — Live multi-agent discovery: parallel scraper agents + review agents + a grading
  agent run as a durable background pipeline (survives closing the tab), adding newly scored
  companies on top of the preset set. This is the actual ongoing-deal-flow product, not just a
  demo trick — but it still builds after Tiers 0–3 and is the first tier cut if time runs short.
- Tier 5 — Outreach + Calendly + calendar population. (CUT FIRST if behind)
- Tier 6 — Polish, error states, seed data, demo script, video.

---

## 2. Stack

- Next.js (App Router) + TypeScript + Tailwind v4 + shadcn/ui (`npx shadcn@latest init` —
  the CLI is `shadcn`, not the deprecated `shadcn-ui`)
- Vercel AI SDK **v7** for LLM calls: `ai` + `@ai-sdk/react` + `@ai-sdk/openai`, installed
  together at `@latest` so the majors align (the core `ai` major does not match the
  provider/react package majors — mismatched pins are a common install failure)
- LLM: OpenAI only (key in hand). Main scoring/reasoning model: `gpt-5.6-terra`; cheap
  classification/extraction model: `gpt-5.6-luna`. Verify exact ids against the OpenAI
  platform docs when pinning, and pin them in one place (`lib/models.ts`) so they can be
  swapped without hunting.
- Supabase (Postgres) for companies, signals, theses, scores. All access is server-side via
  a plain `@supabase/supabase-js` `createClient` with the secret (service-role) key —
  single tenant, no auth, no client-side Supabase, and **no `@supabase/ssr`** (that package
  only exists to sync auth cookies). Migrations via the Supabase CLI.
- Deploy: Vercel
- Graph visual: `react-force-graph-2d` (canvas-only, no three.js) for the deal-flow map,
  with `d3-force`'s `forceRadial` for the radial-by-fit layout
- Discovery pipeline (Tier 4): a multi-agent pipeline — parallel scraper agents over a fixed
  source list (YC directory, Product Hunt launches, HN Show/Launches, GitHub trending,
  Wellfound) plus a search-API agent (Exa or Tavily — pick whichever key is fastest to get)
  for a secondary broaden-the-net pass, a review agent that dedupes/validates/extracts
  signals, and a grading agent that reuses `scoreCompany` (section 5) as-is. Orchestrated with
  **Vercel Workflow DevKit** (`workflow` + `@workflow/next` + `@workflow/ai`) so a run is a
  true durable background job — it keeps running server-side even if the VC closes the tab —
  rather than a request tied to an open connection. No headless browser unless unavoidable.

Sponsor-fit note: this stack naturally stacks OpenAI (reasoning) + Supabase (data) and can
add Databricks framing (confidence-aware insights). Do not bolt on APIs that do not earn
their place.

Infra status: OpenAI API key, Supabase project, Vercel account, and the public GitHub repo
all exist already. Tier 0 is wiring, not signup. Tier 4 adds one new signup: a search-API key
(Exa or Tavily) for the broaden-the-net agent. Workflow DevKit itself needs no separate
account — it deploys as part of the existing Vercel project — but verify at build time whether
anything needs enabling in the dashboard for it to run there.

### Stack gotchas (verified against docs/npm, July 2026 — do not rediscover these)
- AI SDK v7: `generateObject`/`streamObject` are **deprecated**. Structured JSON is
  `generateText` with `output: Output.object({ schema: zodSchema })` → read `.output`.
  Streaming chat: `streamText` → `return result.toUIMessageStreamResponse()`.
- `useChat` (from `@ai-sdk/react`) is transport-based: it returns `messages` + `sendMessage`,
  you manage the input state yourself (the old `input`/`handleInputChange`/`handleSubmit`
  helpers are gone), and messages render via `message.parts[]`, not `message.content`.
- Tailwind v4 is CSS-first: `@import "tailwindcss"` + `@theme` in `globals.css`; there is
  no `tailwind.config.js`. shadcn init handles this — don't hand-create a JS config.
- Supabase CLI flow: `supabase init` → `supabase link --project-ref <ref>` →
  `supabase migration new <name>` (edit the SQL) → `supabase db push`.
- react-force-graph refs break through `next/dynamic` (upstream issues #324/#357): write our
  own `'use client'` wrapper that imports `react-force-graph-2d` directly and holds the ref
  internally, then `dynamic(() => import('./GraphWrapper'), { ssr: false })` the wrapper.
  Inject the radial force after mount: `fgRef.d3Force('radial', forceRadial(...))` and
  weaken charge. If the force fighting gets fiddly, a raw `d3-force` + canvas fallback is
  ~50 nodes of trivial work and fully controllable.
- Workflow DevKit: `"use workflow"` orchestrator functions run in a sandboxed VM (no `fetch`,
  no `setTimeout`, no Node built-ins) — put actual work (fetch calls, OpenAI calls, Supabase
  writes) in `"use step"` functions, which have full Node.js access plus automatic retry and
  cached/replayed results. The workflow function itself should only call steps.
- `start()` (from `workflow/api`) kicks off a run directly from an API route, but if a
  workflow ever needs to start another workflow from inside itself, `start()` must be wrapped
  in a `"use step"` function first — it cannot be called directly in workflow context.
- Stop control for continuous-mode discovery runs: a `createHook()` inside the workflow with a
  deterministic token (e.g. `discovery-stop-{runId}`); the Settings panel's "Stop" button calls
  `resumeHook(token, { stop: true })` from an API route to break the loop cleanly.
- Live agent-activity log: use namespaced streams —
  `getWritable({ namespace: 'logs:scraper' })` / `'logs:review'` / `'logs:grading'` — read back
  with `run.getReadable({ namespace })`. Keeps the verbose per-agent log separate from the
  default stream, which should only carry "new company inserted" events the map needs.
- `DurableAgent` (`@workflow/ai/agent`) handles the workflow-sandbox `fetch` wiring
  automatically — use it for the scraper/review/grading LLM calls instead of raw
  `generateText` inside a workflow function.

---

## 3. Data model (Supabase)

- `theses`: id, name, stage, industries[], min_traction, demographics_pref, raw_thesis_text,
  created_at
- `companies`: id, name, website, github_url, sector, stage, source, indexed_at
- `signals`: id, company_id, kind (commit_cadence | hire | funding | customer_mention |
  traction | press | other), value, source_url, confidence (0–1), extracted_at
- `scores`: id, company_id, thesis_id, fit_score (0–100), confidence (0–1),
  fit_rationale (text), pass_reason (text), contributing_signal_ids[], scored_at
- `outreach` (Tier 5 only): id, company_id, status (not_contacted | contacted | responded |
  booked | needs_info), scheduled_at, notes
- `discovery_runs` (Tier 4 only): id, mode (batch | continuous), target_count (int, nullable —
  batch only), status (running | stopped | completed | failed), workflow_run_id (text, the
  Workflow DevKit run id — used to reattach/stream/cancel after a page reload), thesis_id,
  companies_found (int, default 0), started_at, stopped_at
- `discovery_instructions` (Tier 4 only): id, text, active (bool, default true), created_at —
  persistent free-text guidance the VC gives the discovery agents (e.g. "prioritize fintech
  infra, avoid consumer social"); every active row is concatenated into the scraper/review/
  grading prompts on every future run

Every number a VC sees must trace back to rows in `signals` via `contributing_signal_ids`.
That traceability is the product. No score without its signals.

Discovered companies land in the exact same `companies` / `signals` / `scores` tables as the
preset set — tagged via `source` (e.g. `discovery:producthunt`, `discovery:search`) — so the
map/board render them identically with zero special-casing downstream.

---

## 4. Pre-indexed demo dataset

Before the demo, seed 30–50 real companies with real signals so the agent reasons over
reliable data instead of gambling on live scrape latency. Store as a seed script that
populates `companies` and `signals`. Include at least a handful of companies with genuinely
non-obvious pass reasons, because the sharp bear case is the wow moment and it must be real,
not generic. The Tier 4 discovery pipeline runs on top of this set, not as the thing the demo
depends on.

The dataset is compiled by research agents (task 2.1), not hand-invented: real companies,
real signals, real clickable source URLs. A judge who clicks a citation must land on a page
that supports it.

This is a distinct mechanism from the Tier 4 discovery pipeline. Task 2.1 is a one-time,
offline compilation run by us before the demo, producing the guaranteed-good preset 30–50.
Tier 4 is a live pipeline the VC kicks off at demo time that keeps finding and scoring new
companies in the background — on top of the preset set, never touching it — for as long as
the run is active. The preset set is what makes the demo safe; the live pipeline is what makes
the product real.

---

## 5. The scoring engine (the hard core — get this right)

Input: a thesis + a company's signals. Output: fit_score, confidence, fit_rationale,
pass_reason, and the list of signal ids that drove it.

Requirements:
- Scored against the thesis, not against generic goodness. Swapping the thesis must reorder
  the rankings. This must be visibly true in the demo (run a pre-seed deeptech thesis and a
  Series A consumer thesis over the same pool; show the reorder).
- Traceable: every score links to the specific signals that produced it, each with a source_url.
- Confidence-aware: mark scores resting on thin evidence ("speculative, 1 unverified signal")
  vs strong ("high conviction, 6 sources"). Confidence is a first-class output, not decoration.
- Honest bear case: pass_reason must be specific and falsifiable ("no technical co-founder
  and the core IP is a wrapper on an open model"), never "the market is competitive."

Prompt design: give the model the thesis, the structured signals, and require structured JSON
output (fit_score, confidence, fit_rationale, pass_reason, contributing_signal_ids). Validate
with zod. If the model returns a vague pass_reason, that is a bug to fix in the prompt, not
something to ship.

---

## 6. The deal-flow map (the demo visual)

- react-force-graph. Nodes = companies. Radial position by fit_score to the active thesis
  (high fit → center). Node size by confidence. Node color by sector.
- Edges connect companies sharing a signal (same investor / accelerator / adjacent market).
- On thesis change, nodes re-settle into new positions (this is the "it reasons about fit"
  proof).
- Click a node → slide-in panel with the full evidence-backed report: fit rationale,
  confidence badge, top cited signals (each a clickable source link), and the one-line
  pass reason.
- Fallback if the graph gets fiddly under time pressure: a ranked deal-flow board of cards
  (score, confidence badge, top 3 cited signals, pass reason, click to expand). Build the
  board's card/report component first regardless, because the node drill-down panel reuses it.

---

## 7. Task breakdown — the build steps

Work strictly tier by tier. Two people build with overlapping tasks — there is no fixed
ownership split. Coordinate by committing every working state and reading every diff before
committing. Each step below is a distinct buildable unit with a done-condition (**Done**) and
an observable functional check (**Verify**). Mark steps `[x]` as they complete; a tier's gate
must hold before the next tier starts.

### Tier 0 — Skeleton that deploys
Gate: a fresh clone deploys to Vercel and the live URL streams a model response.

**Status — TIER 0 COMPLETE ✅ (2026-07-18). Deployed to Vercel and gate-verified on the live URL:
https://cormorant-vert.vercel.app — `/` 200, `/api/health` 200, `/api/chat` streams from
`gpt-5.6-terra`, `/api/db-check` round-trip `ok:true`. Tier 1 may begin.**
Built (`npm run build` and `npm run lint` both green):
- Next.js 16 (App Router) + TypeScript + Tailwind v4 + shadcn/ui scaffold. Base components in
  `components/ui/` (button, input, card, badge, dialog, skeleton). shadcn style is `base-nova`,
  which is built on **@base-ui** (not Radix): its `Button` has **no `asChild`** — style a
  `Link` with `buttonVariants(...)` instead (see `app/page.tsx`).
- `app/api/health/route.ts` → `{ ok: true }` (verified: 200).
- `app/api/chat/route.ts` — AI SDK v7 streaming (`streamText` → `toUIMessageStreamResponse()`).
  Note: `convertToModelMessages` is **async** in `ai@7` — must be `await`ed. SSE stream protocol
  verified end-to-end (start → parts → done); real tokens need the key (see Pending).
- `app/dev/page.tsx` — client test console: `useChat` stream view + buttons for the endpoints.
- `lib/models.ts` — pins the two model ids (`reasoning`/`cheap`) and the OpenAI provider.
- `lib/supabase.ts` — server-only admin client (lazy; throws a clear error if env is unset).
- `supabase/migrations/20260718120000_init.sql` — the full §3 schema (incl. the Tier 5
  `outreach` table, so no re-migration later). `app/api/db-check/route.ts` is a **temporary**
  insert+read-back round-trip route (idempotent) — delete it once 0.3 is confirmed live.
- Installed deps: `ai@7`, `@ai-sdk/react@4`, `@ai-sdk/openai@4` (majors intentionally differ,
  per §2), `@supabase/supabase-js@2`. `.env.example` documents the three vars.

Verified live (local dev server, real credentials):
- `/api/health` → 200. `/api/chat` streamed token-by-token from `gpt-5.6-terra`. Both pinned
  ids (`gpt-5.6-terra`, `gpt-5.6-luna`) were confirmed to exist in the OpenAI account via
  `GET /v1/models` — so `lib/models.ts` needs no change.
- Supabase migration applied through the dashboard SQL Editor (CLI not required); `/api/db-check`
  insert + read-back returns `ok:true`. NOTE: that temporary route left one sentinel `companies`
  row (`source='tier0-db-check'`) — delete both `app/api/db-check/route.ts` and that row before
  the demo so it never shows on the map.

Deployed & gate-verified live on **https://cormorant-vert.vercel.app** (Vercel project
`cormorant`, git-connected to `main`; the 3 env vars are set for Production + Preview).

Deploy gotchas hit and fixed (do NOT rediscover these):
1. **Framework preset was "Other".** The initial Vercel import misdetected the framework, so it
   served the repo as static files and **every route (even `/`) 404'd** although `next build`
   ran and the deployment was "Ready" (tell: `vercel inspect` Builds showed `. [0ms]`, no
   `@vercel/next`). Fix: committed `vercel.json` with `{"framework":"nextjs", ...}` (overrides the
   dashboard preset), pushed, git redeployed correctly. Keep `vercel.json`.
2. **Deployment Protection (Vercel Authentication) was ON** → the URL 302-redirected to
   `vercel.com/sso-api` (login wall; judges can't open it). Fix: dashboard → Settings →
   Deployment Protection → Vercel Authentication → Disabled. Keep it off for the demo.
- Env values load at process start; Next dev also hot-reloads `.env.local` on change. `.env.local`
  and `.vercel/` are gitignored; only `.env.example` is tracked. `.vercelignore` keeps env files
  out of any CLI upload.
- Reminder still open: delete the temporary `app/api/db-check/route.ts` and its sentinel
  `companies` row (`source='tier0-db-check'`) before the demo so it never shows on the map.

- [x] **0.1 Scaffold the app.** `create-next-app` (TypeScript, App Router, Tailwind), init
  shadcn/ui, add base components (button, input, card, badge, dialog, skeleton). Placeholder
  home page with the product name.
  **Done:** `npm run dev` serves a styled page with shadcn components rendering.
  **Verify:** open localhost — styled placeholder, no console errors.
- [x] **0.2 Streaming LLM route.** `/api/health` returns `{ ok: true }`. `/api/chat` streams
  an OpenAI completion via the AI SDK (`streamText` → `toUIMessageStreamResponse()`).
  Minimal test UI renders the stream. Create `lib/models.ts` here, pinning the two model ids
  (section 2) after checking them against the OpenAI platform docs.
  **Done:** the local test page shows a response streaming token-by-token (not one blob).
  **Verify:** watch the stream; `curl /api/health` returns 200.
- [x] **0.3 Supabase schema + server client.** Server-only Supabase client using the secret
  (service-role) key (all DB access stays server-side; env var not `NEXT_PUBLIC_`-prefixed).
  One migration implementing the section 3 schema, applied via `supabase db push`. A
  temporary test route inserts and reads back a row.
  **Done:** tables exist; the round-trip works from a route.
  **Verify:** rows visible in the Supabase dashboard.
- [x] **0.4 Deploy.** Push to the GitHub repo, import to Vercel, set env vars
  (`OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`).
  **Done (tier gate):** the production URL streams `/api/chat` and `/api/health` is green —
  verified on the live URL, not localhost. ✅ **https://cormorant-vert.vercel.app**

### Tier 1 — Thesis onboarding
Gate: a saved thesis object drives a downstream call.

**Status — TIER 1 COMPLETE ✅ (2026-07-18, verified locally end-to-end).**
Implementation notes:
- `lib/thesis-schema.ts` — client-safe zod schema + STAGES/INDUSTRIES constants (split out
  because the form is a client component and `lib/theses.ts` pulls in `next/headers`).
- `lib/theses.ts` — server-side thesis DB access + the active-thesis **cookie**
  (`cormorant_active_thesis`). Active thesis = cookie-selected if it exists, else oldest
  thesis, else null. All downstream calls resolve the thesis via `getActiveThesis()`.
- `app/actions.ts` — server actions: `createThesisAction` (zod-validated, sets the new
  thesis active, redirects home) and `setActiveThesisAction` (selector).
- `app/onboarding/page.tsx` + `components/thesis-form.tsx` — the form (native
  select/checkboxes, shadcn Input/Button/Card; base-nova has no Select component).
- `components/site-header.tsx` (+ `thesis-selector.tsx`) in the root layout — brand,
  active-thesis `<select>`, "New thesis" link. Header survives a dead DB (try/catch).

- [x] **1.1 Onboarding form.** Fields: stage, industries (multi-select), min traction,
  demographic prefs, free-text thesis. Zod-validated; persists to `theses` via a server
  action.
  **Done:** submitting creates a `theses` row matching the inputs. ✅ Verified via headless
  browser: submitted a "Seed climate test" thesis (7 quick fields, well under 15s pace);
  the `theses` row matched the inputs exactly (stage `seed`, industries
  `[fintech, climate]`, min_traction preserved). Test row deleted afterwards to keep the
  demo pool clean.
- [x] **1.2 Two theses + active selector.** Seed two contrasting theses (pre-seed deeptech;
  Series A consumer). Header selector sets the active thesis, readable server-side.
  **Done:** switching the selector changes which thesis id downstream calls receive.
  ✅ Both theses seeded by `npm run seed` (idempotent, matched by name). Verified: with the
  test thesis active, `GET /api/rankings` returned its id; after switching the header
  selector to "Pre-seed deeptech", the same call returned `thesis_id` =
  the Pre-seed deeptech id. The cookie is the single source of the active thesis.

### Tier 2 — Scoring engine
Gate: every seed company has a score with linked signals, and rankings reorder between the
two theses.

**Status — TIER 2 COMPLETE ✅ (2026-07-18, gate verified locally AND on a Vercel preview
deployment).** DB state after completion: 43 companies, 125 signals, 86 scores (43 × 2
theses), 2 theses. Implementation notes:
- `lib/seed-data.json` — the pre-indexed dataset: 43 real companies, every signal with a
  real source URL, compiled by 5 parallel research agents (sonnet/haiku for the sector
  batches, opus for the bear-case batch) with every URL WebFetch-verified at research time.
  Curation calls: Ramp dropped (its own signals cite a $750M Series D — outside the
  pre_seed..series_b range), Rime re-sectored healthcare → enterprise_saas. Includes 8
  companies picked specifically for sharp, citable bear cases (Cluely's admitted-fabricated
  ARR, Sakana AI's retracted 100x-speedup claim, Rabbit's 5%-active retention collapse,
  11x's fake customer logos, Thinking Machines' founder exodus, etc.) — the §4 "genuinely
  non-obvious pass reasons" requirement, documented with press citations.
- `lib/scoring.ts` — `scoreCompany(thesis, company, signals)`: `generateText` +
  `Output.object({ schema })` on `gpt-5.6-terra`, zod-validated, up to 3 attempts with the
  validation failure fed back; rejects invented signal ids and generic pass reasons.
- `app/api/score/route.ts` — batch scoring, POST `{thesisId?, force?, companies?}`;
  active-thesis fallback (the Tier 1 downstream call), 4-way concurrency, upsert on
  `(company_id, thesis_id)`, per-company failure isolation, `maxDuration = 300`.
- `app/api/rankings/route.ts` — GET top-N by fit for the active (or `?thesisId=`) thesis.
- `scripts/seed.mjs` + `scripts/validate-seed.mjs` (plain Node, no new deps) —
  `npm run seed` / `npm run seed:validate`. NOTE: `scripts/` is a new top-level dir (needed
  because `npm run seed` can't live inside app/lib); package.json gained the two entries.

Deploy state (2026-07-18): production (git `main`) still serves Tier 0 and is healthy
(`/` 200, `/api/health` ok). The Tier 1+2 work is verified on a Vercel **preview**
deployment built from the working tree (`vercel deploy`) — `/`, `/onboarding`,
`/api/health`, and `/api/rankings` for both theses all green there. Nothing from this
session is committed yet (per working agreement: diffs reviewed before commit); after
review, commit + push to `main` redeploys production with Tiers 1–2, or run
`vercel deploy --prod`. `npm run build` and `npm run lint` are both green.

- [x] **2.1 Research the seed dataset (agents).** ✅ 43 companies (30–50 band), all ≥2
  signals (125 total), sectors 11-wide, stages 4 pre-seed / 15 seed / 12 A / 12 B;
  13 early-deeptech vs 14 later-consumer so the theses must reorder. `npm run seed:validate`
  passes (shape, URL format, signal kinds, counts, bear-case coverage, thesis-contrast
  minimums). **Verify:** an independent spot-check agent re-fetched 12 random signals across
  12 companies: 11/12 load AND support their claim; the 1 partial (Zephyr Fusion funding
  signal citing the homepage for YC-batch details) was fixed by swapping its source_url to
  the YC company page, in both the data file and the DB.
- [x] **2.2 Seed script.** ✅ Idempotent, verified: second run reports 0 created /
  43 updated / 125 signals already present. Matches companies by name, signals by
  (company_id, kind, source_url), theses by name.
- [x] **2.3 `scoreCompany(thesis, signals)`.** ✅ Sample run (Val Town, Modal Labs, Partiful
  vs Pre-seed deeptech): all valid JSON, `contributing_signal_ids` ⊆ input ids (checked in
  DB), and pass reasons specific+falsifiable (e.g. Partiful fit=5: "consumer social-event
  app already through a $20M Series A ... no signal indicates any target deeptech category
  or defensible IP"). No "market is competitive"-grade output observed in any of the 86
  final scores' spot reads.
- [x] **2.4 Batch scoring.** ✅ All 43 companies scored for each thesis (concurrency 4,
  ~25s per 20-company batch, 0 failures across 86 scores); every row has non-empty
  `contributing_signal_ids`.
- [x] **2.5 Re-score on thesis switch + reorder check.** ✅ Cache reuse verified (re-POST
  scores 0, reuses 43). **Tier gate:** both theses fully scored; the two top-10s share ZERO
  companies — deeptech thesis: RightNow AI 92, Kopra Bio 89, Wardstone 89, Bucket Robotics
  88, ... (all pre-seed/seed deeptech); consumer thesis: Partiful 93, Copilot Money 92,
  Praktika AI 89, ... (all Series A consumer/fintech). Differences map directly to the
  theses' stage + industries. Also verified on the Vercel preview deployment via
  `/api/rankings?thesisId=...` for both theses.

### Tier 3 — Deal-flow map + report (the demo)
Gate: the scripted demo (section 8, steps 1–2 and 4–5) works end to end on seed data.

- [ ] **3.1 CompanyReport component.** Reused by the board and the map panel: fit rationale,
  confidence badge (with the "speculative, 1 unverified signal" vs "high conviction,
  6 sources" honesty framing), cited signals as clickable source links, one-line pass reason.
  **Done:** renders correctly for any scored company id, from DB data.
- [ ] **3.2 Ranked board (guaranteed fallback).** Cards sorted by fit: score, confidence
  badge, top-3 cited signals, pass reason; click expands into CompanyReport.
  **Done:** the entire demo can run on the board alone if the graph misbehaves.
- [ ] **3.3 Force-graph map.** `react-force-graph-2d` via the `'use client'` wrapper +
  `dynamic(ssr: false)` pattern from the stack gotchas. Radial position by fit via
  `forceRadial` (high fit → center), node size by confidence, color by sector, edges between
  companies sharing a signal (same investor / accelerator / adjacent market).
  **Done:** the seed set renders and settles smoothly, and node positions visibly correlate
  with fit scores in the DB.
- [ ] **3.4 Drill-down + thesis-swap resettle.** Node click → slide-in CompanyReport panel.
  Thesis switch → nodes animate to their new positions.
  **Done (tier gate):** demo steps 1, 2, 4, 5 run back-to-back with no dead ends.
- [ ] **3.5 Map/board toggle.** Both views share the same data layer.
  **Done:** toggling flips views with no refetch weirdness.

### Tier 4 — Live multi-agent discovery (real background pipeline)
Gate: a discovery run adds ≥1 new scored node in the background — verified by starting a run,
closing the tab, and finding the new node on reload.

- [ ] **4.1 Discovery data model.** Migration adding `discovery_runs` and
  `discovery_instructions` (section 3).
  **Done:** tables exist; a hand-inserted `discovery_instructions` row is readable.
- [ ] **4.2 Source integrations.** One fetch+parse function per fixed source (YC directory,
  Product Hunt, HN Show/Launches, GitHub trending, Wellfound) returning raw candidate mentions
  (name, snippet, source_url). One search-API function (Exa or Tavily) taking a query string
  and returning the same shape, for the broaden-the-net pass.
  **Done:** each source function returns ≥1 real candidate when run standalone.
- [ ] **4.3 Discovery workflow (Workflow DevKit).** A `"use workflow"` orchestrator wiring:
  parallel scraper-agent steps (one per fixed source + the search-API step, each reading the
  active thesis + active `discovery_instructions` as context) → parallel review-agent steps
  (dedupe against existing `companies` by name/domain, verify the source_url actually supports
  the claim, extract structured `signals` with the cheap model, reject anything without a
  citable URL) → a grading-agent step that calls the same `scoreCompany` from Tier 2, unchanged
  → an insert step (company + signals + score, tagged `source='discovery:<name>'`) that
  increments `discovery_runs.companies_found`. Loop control: batch mode stops at
  `target_count`; continuous mode loops with a `sleep()` between rounds and a `createHook()`
  stop signal checked each round. Every step is isolated — one candidate or source erroring
  never drops data already inserted.
  **Done:** `start()`ing the workflow inserts ≥1 new company with signals and a score, in both
  batch and continuous mode; resuming the stop hook ends a continuous run cleanly.
  **Verify:** kill the network mid-run — nothing already inserted is lost or duplicated on
  retry.
- [ ] **4.4 Discovery settings UI.** A settings panel: mode toggle (batch with a target-count
  input, default 5–10, vs continuous), start/stop controls (`start()` / stop-hook resume), a
  free-text instructions box that upserts into `discovery_instructions` and visibly steers the
  next run, and a live agent-activity log reading the namespaced streams (`logs:scraper` /
  `logs:review` / `logs:grading`).
  **Done:** starting a batch run from the UI, closing the tab, and reopening the app later
  shows the completed run's new companies already on the map.
- [ ] **4.5 Map integration.** Discovered companies render on the map/board exactly like seed
  companies (same data layer, no special-casing) and drop in live while a run is active and
  the panel is open.
  **Done (tier gate):** demo step 3 works on camera — a run kicked off live adds a node that
  visibly settles into position by fit score.

### Tier 5 — Outreach + Calendly (CUT FIRST IF BEHIND)
Gate: a one-button flow updates status end to end.

- [ ] **5.1 Reach-out flow.** Button on CompanyReport → `outreach` row, status → contacted;
  Calendly scheduling link; on booking (test account only), write `scheduled_at`, status →
  booked; node color/state reflects status; simple upcoming-calls list.
  **Done:** the full status lifecycle is visible on the map without sending anything to real
  people.

### Tier 6 — Polish & video
Gate: nothing crashes on camera; video recorded with buffer.

- [ ] **6.1 Loading/error/empty states** on every screen the demo touches; skeletons before
  the first token.
  **Done:** with network throttled, the app shows skeletons — never raw errors.
- [ ] **6.2 Demo reset.** One control that restores pristine seed state (wipe discovery
  additions, reset outreach, re-seed).
  **Done:** after a full demo run, one click returns the app to its pre-demo state.
- [ ] **6.3 Submission hygiene.** README architecture diagram + data-sources section
  finalized; Ctrl+F the live rules page per section 9 and comply.
  **Done:** README passes the section 9 checklist.
- [ ] **6.4 Record the video.** Follow section 8 exactly, on seed data, with 3+ hours of
  buffer before the freeze.
  **Done:** video recorded and uploaded per submission requirements.

---

## 8. Scripted demo test case (build toward this exact sequence)
1. VC onboards with a specific thesis in ~15 seconds.
2. Hit run; the seed set scores; the deal-flow map fills, companies settling by fit.
3. (Tier 4) kick off live discovery (batch or continuous, from the Settings panel); a new
   company node drops in and scores on camera while the rest of the demo continues.
4. Click the standout company: strong cited fit thesis + a sharp, specific pass reason.
5. Swap to a second thesis; the same pool visibly reorders.
6. (Tier 5, only if built) one-click reach out; node flips to "contacted".

Everything in this sequence must work on seed data alone, so a dead network never kills the demo.

---

## 9. Rules / submission hygiene
- Public repo, clean README, this PLAN.md at root, architecture diagram in README.
- Add a "Data sources" section to the README listing any datasets/APIs used (standard Devpost
  requirement in this event family).
- Keep CLAUDE.md and the Claude co-author trailer; they are on-theme, not a liability.
- At kickoff, Ctrl+F the live rules page for "AI-generated", "AI-assisted", "disclose",
  "data sources" and comply with whatever is actually written.

Verified event facts (web-researched 2026-07-18 — confidence flags noted):
- **Submission freeze: Sunday July 19, 9:00 AM ET.** Hack days are July 18–19 — this is a
  ~24-hour build, not 48. Plan the tier cut-lines accordingly. Finalist pitches (3 minutes,
  top-3 per challenge only) happen Saturday July 25.
- Global-event submissions go through the **projects.hack-nation.ai portal**, not Devpost.
- The official judging rubric is gated behind the participant dashboard. Third-party
  (unverified) criteria: Creativity, Completeness, Business Viability, Presentation, with a
  video up to 3 minutes. Completeness + Presentation are exactly what the tier discipline
  and the scripted demo protect.
- Repo/AI-disclosure/data-source rules were **not publicly findable**. Action: pull the
  actual challenge brief and rules from the participant dashboard (they were revealed at
  kickoff) and treat those as authoritative — including the exact VC Brain / sponsor
  framing, which public sources could not confirm.

---

## Prompt for Claude Code (paste this to start)

> Read PLAN.md in the repo root in full before doing anything. Then implement it strictly in
> tier order, starting at Tier 0. Do not begin a tier until the previous tier's done-condition
> is met and committed. For each task: state the done-condition, implement it, verify it, then
> stop and let me review the diff before committing. Do not touch files outside /app, /lib,
> /components, /supabase without asking. Do not add dependencies without asking. If a task is
> ambiguous, ask rather than guess. Keep PLAN.md updated as the source of truth: as tiers
> complete, mark them done; if we cut a tier, delete its tasks rather than leaving them
> half-written. Save all planning notes back into PLAN.md, never into a separate file.
