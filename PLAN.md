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
- Billing, teams, roles.
- Anything that sends real outbound messages to real people during judging.

**Scope amendment (2026-07-18, post-Tier-3):** per-user Google sign-in was added (see
"Tier 1.5 — Auth" below), so "multi-tenant auth" is no longer out of scope — each signed-in
VC gets their own private theses. `companies`/`signals`/`scores` (the pre-indexed dataset)
stay shared/global across every account; only `theses` rows are user-owned. This was a
deliberate scope change requested outside the original tier plan, made this close to the
freeze — flagged as a risk, not silently absorbed.

**Scope amendment (2026-07-19, per-user data isolation):** the "companies/signals/scores stay
global" line above was found to leak across accounts — one VC's discovered companies,
discovery instructions, and discovery runs were visible to (and stoppable by) every other
account. Fixed by scoping companies and discovery per-user while keeping the seed set shared:
- `companies` gained a nullable `user_id` (migration
  `supabase/migrations/20260719120000_per_user_data.sql`). `user_id IS NULL` = the shared
  pre-indexed 43-company demo pool, visible to everyone; a non-null `user_id` = a company that
  VC discovered, private to them. Every company read is now `user_id IS NULL OR user_id = me`
  (`app/api/score/route.ts`, `lib/dealflow.ts`, and the discovery dedup in
  `lib/discovery/pipeline.ts`).
- `signals` stay owner-less but inherit visibility through their `company_id` (the score route
  now loads signals only for visible companies; dealflow reads them via the score→company embed).
- `scores` still partition per-user through `thesis_id` (theses are per-user) — no new column.
- `discovery_instructions` and `discovery_runs` gained `user_id`; the instructions/start/status/
  stop/stream routes and the pipeline now filter by it. The "one run at a time" lock is now
  per-user, and Stop/stream enforce ownership. *(The `discovery_instructions` table and its
  route were later removed outright — 2026-07-18 Tier 4 cleanup Update.)*
- RLS was enabled on all four tables as defense-in-depth (the service-role client still bypasses
  it; app-level `user_id` filters remain the real enforcement, same as `theses`).

Login fixes shipped alongside: `signOutAction` now clears the active-thesis cookie; the home
page renders the previously-silent `?signin=1` / `?auth_error=1` notices; and `/dealflow`
redirects a thesis-less user to `/onboarding` instead of showing an empty screen.

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
  for a secondary broaden-the-net pass and a funding-news agent (TechCrunch keyless search)
  for later-stage supply, a review agent that dedupes/validates/extracts
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
- Stop control for a discovery run: cooperative — the Settings panel's "Stop" button flips
  `discovery_runs.status` to `stopped` via an API route, and the workflow checks that status
  between rounds (in `loadContext`) and ends at the next round boundary. (An earlier
  `createHook()`/`resumeHook()` stop signal existed only to break the continuous-mode sleep;
  it was removed with continuous mode — see the Tier 4 status.)
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
- `discovery_runs` (Tier 4 only): id, mode (text — retained in the schema but always `batch`
  since continuous mode was removed), target_count (int — how many companies the run finds),
  status (running | stopped | completed | failed), workflow_run_id (text, the Workflow DevKit
  run id — used to reattach/stream/cancel after a page reload), thesis_id, companies_found
  (int, default 0), started_at, stopped_at

(A `discovery_instructions` table existed briefly — persistent free-text guidance fed to the
agents — and was removed 2026-07-18: discovery is steered by the active thesis alone. See the
Tier 4 cleanup update.)

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

### Tier 1.5 — Auth (Google sign-in, per-user theses)
Added post-Tier-3, outside the original tier order (see scope amendment above).
Gate: signing in with Google, creating/editing/deleting a thesis, and having only that
account's theses appear on reload.

**Status — TIER 1.5 COMPLETE ✅ (2026-07-18, verified live).** `npm run build` and
`npm run lint` are green, Google sign-in is functional end-to-end, and per-user thesis
create/edit/delete via the Thesis menu Save button is verified working. Everything is
uncommitted on `saahil` pending review, per the instruction that started this work.

Implementation notes:
- Auth backend: **Supabase Auth** (same Supabase project, not a separate identity provider),
  using `@supabase/ssr` for cookie-synced sessions — the one dependency PLAN.md §2 originally
  said we would NOT need ("no `@supabase/ssr` — only exists to sync auth cookies, which we do
  not have"). We now have auth cookies, so this is a deliberate reversal of that line, not an
  oversight.
- `lib/supabase-browser.ts` / `lib/supabase-server.ts` — new anon-key clients (auth/session
  only, never data access). `lib/supabase.ts` (service-role, data access) is unchanged and
  still does all `companies`/`signals`/`scores`/`theses` reads/writes.
- `lib/auth.ts` — `getCurrentUser()`, the single place every route/page/action asks "who is
  this."
- `proxy.ts` (Next.js 16 renamed `middleware.ts` → `proxy.ts`, exported function `proxy` not
  `middleware` — do not rediscover this, `next build` throws a clear error if you get the
  export name wrong) — refreshes the session cookie every request and redirects signed-out
  visits to `/onboarding` or `/dealflow` back to `/`.
- `app/auth/callback/route.ts` — OAuth code exchange; `components/sign-in-button.tsx` (client,
  calls `supabase.auth.signInWithOAuth({ provider: "google" })`); `signOutAction` in
  `app/actions.ts`.
- `supabase/migrations/20260718140000_theses_auth.sql` — adds nullable `theses.user_id
  references auth.users(id)` + RLS policy scoped to `auth.uid() = user_id`. Nullable so the
  two existing seed theses don't need a backfill — they just stop matching any account's
  queries (orphaned, harmless). RLS is defense-in-depth only: the service-role client used
  for all app queries bypasses RLS entirely, so `lib/theses.ts` filters by `user_id`
  explicitly in every query — that app-level filter is the real enforcement.
- `lib/theses.ts` — every function now takes `userId`; added `updateThesis` / `deleteThesis`.
  `companies`/`signals`/`scores` stay unscoped/shared across all accounts (the pre-indexed
  demo dataset is common; only which thesis to score against is personal).
- `components/thesis-menu.tsx` — header "Thesis menu" button (replaces the old "New thesis"
  link) opens a dialog: list of the signed-in user's theses, per-row Edit/Delete, "+ New
  thesis". Delete is immediate (single irreversible click); Edit/Create open `ThesisForm`
  inline with its own Save button (`updateThesisAction` / `createThesisAction`).
  `components/thesis-form.tsx` was extended (not duplicated) to serve both create and edit by
  optionally accepting a `thesis` prop.

Manual setup completed to make this functional (not code — dashboard/console
configuration, do NOT rediscover these):
1. Google Cloud Console → OAuth client (Web application) → client id/secret created.
2. Supabase dashboard → Authentication → Providers → Google → enabled with that client
   id/secret.
3. Supabase dashboard → Authentication → URL Configuration → Redirect URLs → 
   `http://localhost:3000/auth/callback` added (add the production URL's `/auth/callback`
   too once deployed, if not already).
4. Supabase dashboard → SQL Editor → `supabase/migrations/20260718140000_theses_auth.sql`
   applied (no CLI link set up in this repo, same as Tier 0's migration).
5. `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (anon/public key from
   Supabase dashboard → Settings → API) added to `.env.local`.

- [x] **1.5.1 Google sign-in.** ✅ Verified live: sign in redirects to Google, back to
  `/auth/callback`, then `/dealflow`; header shows the account email + Sign out.
- [x] **1.5.2 Per-user theses.** ✅ Verified: theses are scoped per signed-in Google account
  in the selector and the Thesis menu.
- [x] **1.5.3 Edit/delete via Thesis menu.** ✅ Verified: editing a thesis and clicking Save
  updates it in place; deleting removes it and, if it was active, falls back to another
  owned thesis or the onboarding empty state.

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

Deploy state (2026-07-18, refreshed after Tier 3): PR #2 merged `saahil` → `main`
(1bc740f), so **production now serves Tiers 0–2** and is healthy — `/`, `/onboarding`,
and `/api/rankings` (real scores) all green on cormorant-vert.vercel.app. Tier 3's work
is uncommitted in the working tree on `saahil`, verified on a fresh Vercel preview
deployment (see Tier 3 status); committing + merging ships it to production.
`npm run build` and `npm run lint` green.

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

**Status — TIER 3 COMPLETE ✅ (2026-07-18, gate verified locally in a headless browser
AND on a fresh Vercel preview deployment). Uncommitted — review the diff, then commit.**
Implementation notes:
- `lib/dealflow.ts` + `app/api/dealflow/route.ts` — the ONE data layer both views render
  from: companies with their score + embedded signals for a thesis (via a nested
  PostgREST select from `scores`), plus the §6 edges. Edges: shared-investor/accelerator
  mentions extracted from signal text against a fixed entity list (YC + "Y Combinator"
  merge to one label; a16z, Benchmark, Accel, …) → 48 edges, and same-sector "adjacent
  market" pairs → 62. Groups >5 connect ring+chords instead of cliques (the 14-company
  YC batch would otherwise be 91 edges of hairball).
- `components/company-report.tsx` (3.1) — report + `ConfidenceBadge` with the honesty
  framing ("High conviction · 6 sources" / "Moderate evidence · N" / "Speculative · 1
  thin signal" from confidence × contributing-signal count); bear case as its own
  destructive-tinted block; cited signals as clickable source links; "N more signals on
  file didn't drive this score" honesty line.
- `components/deal-board.tsx` (3.2) — ranked cards (rank, score, sector dot, confidence
  badge, top-3 cited signals, pass line) → dialog with the full CompanyReport.
- `components/graph-wrapper.tsx` (3.3) — per the stack gotcha: imports
  `react-force-graph-2d` directly, holds the ref internally; `deal-map.tsx` wraps THIS
  file in `dynamic(ssr:false)`. `forceRadial` radius = f(fit) injected after mount,
  charge weakened to −25, link strength 0.02 (visual, doesn't fight radial), faint
  fit-80/50/20 guide rings, name label drawn under every node (identity never
  color-alone), `zoomToFit` once on first settle.
- Sector colors (`lib/sectors.ts`): 8 validated categorical slots (CVD-checked against
  the white surface — worst adjacent ΔE 9.1); the three 2-company deep-tech sectors
  (biotech/space/defense) fold to neutral gray per the >8-slots rule. Legend on the map.
- `components/dealflow-view.tsx` + `app/dealflow/page.tsx` — data flow: server page
  resolves the active thesis (cookie) → client view fetches `/api/dealflow?thesisId=`.
  "Run scoring" POSTs `/api/score` and polls dealflow every 2.5s so companies DROP ONTO
  THE MAP as their rows land (demo step 2 is a live fill, ~90s for 43 on `terra`).
  Node objects are cached by company id and MUTATED on refetch — that's what makes
  thesis swap a resettle animation instead of a fresh layout. Do NOT key the view (or
  map) by thesis id: a remount resets positions.
- Tier 1 touch-ups while here: thesis selector got `key={activeId}` (an uncontrolled
  select ignores `defaultValue` updates — after creating a thesis the header showed the
  stale name); onboarding now redirects to `/dealflow` (straight into demo step 2);
  header gained a "Deal flow" link; home CTA → `/dealflow`.

- [x] **3.1 CompanyReport component.** ✅ Verified for map panel and board dialog from
  live DB data (Chalk: fit 36 vs deeptech with "Moderate evidence · 3 sources"; same
  company fit 15 vs consumer with a consumer-specific bear case — the report is
  thesis-relative all the way down).
- [x] **3.2 Ranked board (guaranteed fallback).** ✅ All 43 ranked cards render (consumer
  thesis: Partiful 93 / Copilot Money 92 / Praktika AI 89 — matches the Tier 2 gate);
  card click → full report dialog with working citation links.
- [x] **3.3 Force-graph map.** ✅ 43 nodes + 110 edges settle smoothly; radial-by-fit
  visibly correct on both seeded theses (deeptech thesis: pre-seed deeptech center,
  consumer periphery; consumer thesis: the exact inversion). No console errors.
- [x] **3.4 Drill-down + thesis-swap resettle.** ✅ Node click slides in the report
  panel; header thesis swap refetches and the SAME pool re-settles (an open panel even
  live-updates its numbers for the new thesis). **Tier gate:** demo steps 1→2→4→5 ran
  back-to-back in one headless-browser session: onboarded a fresh thesis (seconds),
  Run scoring filled the map live (43/43, 0 failures, on-thesis companies visibly
  center), drill-down showed cited fit + sharp pass reason, swap reordered. Temp QA
  thesis + its 43 scores deleted afterwards (cascade) to keep the demo pool clean.
- [x] **3.5 Map/board toggle.** ✅ Same payload feeds both views; toggling is pure client
  state, zero refetch.

Verified on Vercel preview (built from the working tree, `vercel deploy`):
`/`, `/dealflow`, `/onboarding`, `/api/health`, `/api/dealflow`, `/api/rankings` all
green; map renders and node-click drill-down works on the deployed URL
(cormorant-4pl7tijvs-saahilshah178s-projects.vercel.app). Production (`main`) untouched.

### Tier 4 — Live multi-agent discovery (real background pipeline)
Gate: a discovery run adds ≥1 new scored node in the background — verified by starting a run,
closing the tab, and finding the new node on reload.

**Status — TIER 4 COMPLETE ✅ (2026-07-18, gate verified locally end-to-end in a headless
browser). Uncommitted on `saahil` — review the diff, then commit.** `npm run build` and
`npm run lint` are green. Built as a real Workflow DevKit durable pipeline (`workflow` +
`@workflow/next`), not a request-bound job.

**Bugfix (2026-07-18, post-Tier-4): batch under-delivered its target count.** A batch of 15
returned only ~6. Root cause: the loop re-scraped the same sources every round and re-triaged
to the same top candidates, which after round 1 were all already-indexed and got rejected in
review — so the candidate window never advanced — and a hard `MAX_BATCH_ROUNDS = 3` cap then
exited the loop far below target while still reporting `completed`. Fix (`lib/discovery/pipeline.ts`):
(1) thread an exclusion set (indexed + already-reviewed-this-run, rejects included) into the
scrape/triage step so each round surfaces *fresh* companies deeper in the sources; (2) replace
the fixed 3-round cap with loop-until-target / loop-until-dry (`MAX_DRY_ROUNDS` consecutive
empty rounds → stop; `MAX_TOTAL_ROUNDS` safety cap); (3) size the review fan-out to the
remaining gap; widen triage 5→8/source. Verified: control-flow simulation reaches 15/15 when
supply exists and terminates honestly at true supply when it doesn't. Determinism preserved —
the exclusion is derived from memoized `loadContext` output + step-derived state, so it replays
identically.

**Update (2026-07-18): continuous mode removed + scope widened.** Continuous scanning was cut
— discovery is now purely "find exactly N companies." Removed: the mode toggle (UI), the
`mode` request field, the `createHook`/`sleep`/`resumeHook` machinery, and the `Promise.race`
loop; Stop is now a cooperative `discovery_runs.status` flip the loop checks between rounds.
The `discovery_runs.mode` column is retained (always `batch`) to avoid a manual migration. To
fix the "scope of companies feels limited" complaint and make **N requested = N found**
reliable, candidate supply was widened substantially in `lib/discovery/sources.ts`: YC pulls
**4** recent batches (was 2) with industry/subindustry/tags surfaced for niche triage, HN adds
**Launch HN** alongside Show HN, GitHub widened to a **60-day** window, per-source caps raised
(25→40), and the keyless search pass now queries **HN full-text + GitHub repos** (two
populations). The search agent's query now **rotates shape each round and probes a niche
vertical on ~every third round** (`buildSearchQuery`), so the net keeps widening into
specialized companies rather than re-hitting the obvious names. `npm run build`
(`workflows build complete (10 steps, 1 workflow)`) and `npm run lint` are green.

**Update (2026-07-18, discovery cleanup): standing instructions removed + niche-criteria and
citation fixes.** A "Series B" run returned 0/15 with the log full of `source_url 403 — not
citable` rejects. Three fixes shipped together:
1. **Standing `discovery_instructions` removed entirely** — discovery is steered by the active
   thesis alone (stages, industries, free-text); the VC edits the thesis or switches to another
   to steer a run. Removed: the panel's instructions section, `app/api/discovery/instructions/`,
   all pipeline plumbing, and the table itself (migration
   `supabase/migrations/20260719150000_drop_discovery_instructions.sql` — apply via the
   dashboard SQL editor like the prior migrations).
2. **The 403 reject flood was two real bugs, both fixed.** The review agent fetched citations
   with a `CormorantBot/1.0` UA (403'd by pages that serve the scrapers' browser UA fine), and
   Product Hunt post pages bot-wall EVERY server fetch (403 on all UAs and networks tried, incl.
   the `/r/p/` redirect — verified live), so every PH candidate died in review. Review now
   resolves evidence through a fallback chain (`resolveEvidence` in `lib/discovery/pipeline.ts`):
   the source page (browser-like shared headers, one retry on 429/5xx) → the company's own
   website (the citation switches to the page that was actually verified) → the source's
   first-party feed excerpt for bot-walled sources (citation kept — the page loads for a human
   clicking it — but signals are capped at 2 with confidence ≤ 0.4, enforced in code, so thin
   evidence reads as "Speculative" downstream). A 404/410 or a page that doesn't mention the
   company still rejects outright.
3. **Later-stage / niche supply.** Every fixed source is launch-oriented (recent YC batches,
   Show/Launch HN, PH, new GitHub repos), so a Series A/B thesis had near-zero supply. Added a
   funding-news scraper — TechCrunch's keyless WordPress REST search (`news` SourceKey in
   `lib/discovery/sources.ts`; VentureBeat and Finsmes bot-wall theirs, verified 2026-07-18) —
   queried each round from the thesis's industries × stages. Queries now use the human labels
   ("Fintech Series B"), not raw slugs (`series_b`) — the old search queries were built from
   slugs, which are bad search terms. Triage is now stage-aware (skips hobby demos for
   late-stage theses and established companies for pre-seed ones). Verified live: "Fintech
   Series B" → 20 real candidates (Sarvam, Equal AI, Moment Energy, …) with fetchable
   TechCrunch citations. `npm run build` and `npm run lint` green.

Implementation notes:
- Deps added: `workflow@4` + `@workflow/next@4` (per §2). NOT `@workflow/ai` — its
  `DurableAgent` peers on `ai@^6` and this repo is on `ai@7`, so the scraper/review/grading
  "agents" are plain `generateText` calls inside `"use step"` functions (same durability, full
  Node access, no sandbox `fetch` shim needed). This is a deliberate deviation from §2's
  "`@workflow/ai` + `DurableAgent`" line, forced by the ai-major mismatch — flagged, not silent.
- `next.config.ts` wrapped with `withWorkflow(...)` (enables the `"use workflow"`/`"use step"`
  directives; generates the `/.well-known/workflow/v1/*` routes). `proxy.ts` matcher now
  excludes `\.well-known/workflow/` — without this the proxy intercepts WDK's internal step
  requests and breaks execution/resumption (the §2 gotcha, in the wild).
- `lib/discovery/sources.ts` (4.2) — one fetch+parse function per source returning a uniform
  `{name, snippet, source_url, source, website}`. Deliberately **broad supply** so a run can
  actually hit its target and reach niche companies: YC via the **yc-oss** static mirror
  (`batches/<slug>.json`, **four** most-recent batches, with industry/subindustry/tags in the
  snippet so triage can spot niche verticals), HN **Show HN + Launch HN** via the **Algolia**
  API, Product Hunt via its public **Atom feed** (regex parse, no XML dep), GitHub via the
  keyless **search API** (repos created in the last **60 days** by stars). Wellfound is
  DataDome bot-walled from every network tried (403 challenge on all paths incl. sitemap.xml)
  — the function is implemented and parses normally if it ever unblocks, but degrades to `[]`
  with a warning instead of failing the round. Search (broaden-the-net) uses **Exa or Tavily**
  when `EXA_API_KEY`/`TAVILY_API_KEY` is set, else a **keyless HN full-text search + GitHub
  repo search** fallback (two different populations) so the pass still runs with zero extra
  signups (documented deviation from §2's "Exa or Tavily" — no key was provisioned; drop one
  in for still wider reach). Funding news (`news`) via **TechCrunch's keyless WordPress REST
  search** — the pass that gives later-stage (Series A/B) and niche theses real supply, since
  every other source is launch-oriented (added in the 2026-07-18 discovery cleanup).
- `lib/discovery/pipeline.ts` (4.3) — the `discoveryWorkflow` orchestrator. Per round:
  parallel `scrapeSource` steps (5 fixed sources + the query-driven search and news agents,
  each steered by the thesis; the cheap, stage-aware model triage picks the few worth
  reviewing) → parallel `reviewCandidate` steps (dedupe by normalized name/domain against
  existing `companies`; **verify the citation via the `resolveEvidence` fallback chain** —
  source page → company website → first-party feed excerpt for bot-walled sources
  (confidence-capped) — rejecting 404s and pages that don't mention the company; extract ≤4
  structured signals with the cheap model, grounded only in the verified evidence text;
  reject anything with no citable signal)
  → `insertAndGrade` (insert company + signals, then the SAME Tier-2 `scoreCompany` unchanged,
  persist the score, bump `discovery_runs.companies_found`; a scoring failure **rolls the
  company back** so the map never shows an unscored ghost node). Loop control: each round
  excludes companies already indexed (DB) or already reviewed this run (rejects included) from
  triage, so successive rounds **advance deeper into the sources** instead of re-picking the
  same top candidates; the run loops until it hits `target_count`, or until the sources stop
  yielding new companies (`MAX_DRY_ROUNDS` consecutive empty rounds), bounded by a
  `MAX_TOTAL_ROUNDS` safety cap; the per-round review fan-out is sized to the remaining gap
  (`2× need`, capped) so it never over-reviews past the target; the search agent rotates its
  query each round and probes a niche vertical on ~every third round. A cooperative **Stop**
  flips `discovery_runs.status`, which the loop checks between rounds. Every step catches its
  own errors and returns empty/null, so one candidate/source failing never drops inserted data.
- API routes: `app/api/discovery/{start,stop,status,stream}/route.ts`.
  `start` inserts the `discovery_runs` row, `start()`s the workflow, records `workflow_run_id`
  (reattach after reload). `stop` flips DB status (cooperative — the loop checks it between
  rounds). `stream` proxies `run.getReadable({namespace})` for the per-agent logs.
- `components/discovery-panel.tsx` (4.4) — header "Discovery" dialog: a target-count input
  ("Companies to find"), start/stop, and the live agent-activity log
  reading the three namespaced streams (`logs:scraper`/`logs:review`/`logs:grading`,
  color-coded). Polls `/api/discovery/status` while a run is live — dialog open or not — and
  calls the dealflow refetch so nodes drop onto the map as they're scored. On mount it
  reattaches to the latest run (incl. one that finished while the tab was closed).
- `components/dealflow-view.tsx` — mounts `<DiscoveryPanel onRefresh={fetchData} />` next to
  Run scoring; discovered companies flow through the EXACT same `/api/dealflow` layer and
  `DealMap`/`DealBoard`/`CompanyReport` components as the seed set (4.5, zero special-casing —
  they're just `companies` rows tagged `source='discovery:<key>'`).
- `vercel.json` — `regions:["iad1"]` (the WDK Vercel-World backend region) and
  `functions` config giving the stream route `supportsCancellation:true` (WDK gotcha: a route
  piping `run.getReadable()` bills until max-duration on client disconnect without it).
- Migration `supabase/migrations/20260718170000_discovery.sql` (4.1) — the two §3 tables,
  applied via the dashboard SQL Editor (same manual path as Tier 0 / 1.5; no CLI link in repo).

- [x] **4.1 Discovery data model.** ✅ Both tables exist (verified via PostgREST 200); a
  hand-inserted `discovery_instructions` row was read back by id. *(That table was dropped in
  the 2026-07-18 cleanup — see the Update above; `discovery_runs` is the one that remains.)*
- [x] **4.2 Source integrations.** ✅ Standalone run: YC 50, Product Hunt 25, HN 25, GitHub 25,
  search (keyless HN fallback) 11 real candidates each, with real source URLs. Wellfound 0
  (DataDome 403 — implemented, degrades gracefully, documented above).
- [x] **4.3 Discovery workflow (Workflow DevKit).** ✅ Batch (target 2) run to completion
  inserted 2 NEW companies, each with signals and a Tier-2 score (e.g. "Archal" [discovery:yc]
  fit 58, pass reason "No signal shows any real product usage, customer deployment, or
  traction…" — specific + falsifiable, citing real YC URLs). The Stop button ended a live run
  cleanly (status→stopped). *(Verified pre-continuous-removal; Stop is now a cooperative status
  flip — see the Update note above.)* **Verify (data
  integrity):** across all runs, zero duplicate company names (name/domain dedupe + a live
  last-line DB check hold); grading-failure rollback keeps unscored ghosts off the map.
- [x] **4.4 Discovery settings UI.** ✅ Panel verified in a headless browser:
  target input, start/stop, the standing-instructions list *(feature since removed — see the
  2026-07-18 cleanup Update)*, and the live color-coded activity log replaying
  all three namespaced streams (scraper source counts + triage picks, review dedupe/citation
  rejections, grading scores). Reattaches to the last run on reload.
- [x] **4.5 Map integration.** ✅ Discovered companies render as radial nodes (sector color,
  name label, fit-position, shared-investor edges) identically to seed companies via the shared
  data layer. **Tier gate:** started a batch run, moved the browser OFF the app (tab "closed"),
  the run completed in the background (2 found), and a FRESH `/dealflow` reload showed the new
  node ("Rindler") on the map — run → close tab → new node on reload, no console errors.

Deploy state (2026-07-18): verified on a fresh Vercel PREVIEW built from the working tree
(`vercel deploy`, uncommitted — production `main` untouched, same pattern as Tier 3). The
build log shows `workflows build complete (10 steps, 1 workflow)` — the WDK build step
registered the pipeline — and the app built in `iad1` (the Vercel-World backend region).
On the preview: `/api/health` 200, `/` 200 (no SSO wall), the auth-gated discovery routes
401 without a session and 200 with one; **a batch discovery run started via the deployed API
ran to completion on the managed Vercel World** (`wrun_…`, status → completed, 2 companies
found) and the deployed `/api/dealflow` served the discovered companies (fit + 4 signals +
sharp pass reason each), rendering as radial nodes on the live URL. So the durable pipeline
works on Vercel, not just locally. All QA artifacts (the throwaway test thesis/user, the
discovered test companies, and the session's `discovery_runs`/`discovery_instructions` rows)
were deleted afterwards to restore the pristine 43-company seed pool. Committing + merging
`saahil` → `main` ships Tier 4 to production; the migration
`supabase/migrations/20260718170000_discovery.sql` is already applied to the shared Supabase
project (used by preview + prod), so no further DB step is needed on merge. `npm run build`
and `npm run lint` green.

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
3. (Tier 4) kick off live discovery (pick how many companies to find, from the Settings
   panel); new company nodes drop in and score on camera while the rest of the demo continues.
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
