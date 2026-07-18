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
- Tier 4 — Live discovery/scrape shown as a timelapse. (nice-to-have, adds the "it's real" proof)
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
- Scraping/discovery (Tier 4): a simple server-side fetch + parse over a fixed source list;
  no headless browser unless unavoidable

Sponsor-fit note: this stack naturally stacks OpenAI (reasoning) + Supabase (data) and can
add Databricks framing (confidence-aware insights). Do not bolt on APIs that do not earn
their place.

Infra status: OpenAI API key, Supabase project, Vercel account, and the public GitHub repo
all exist already. Tier 0 is wiring, not signup.

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

Every number a VC sees must trace back to rows in `signals` via `contributing_signal_ids`.
That traceability is the product. No score without its signals.

---

## 4. Pre-indexed demo dataset

Before the demo, seed 30–50 real companies with real signals so the agent reasons over
reliable data instead of gambling on live scrape latency. Store as a seed script that
populates `companies` and `signals`. Include at least a handful of companies with genuinely
non-obvious pass reasons, because the sharp bear case is the wow moment and it must be real,
not generic. The live scrape (Tier 4) runs on top of this as a timelapse, not as the thing
the demo depends on.

The dataset is compiled by research agents (task 2.1), not hand-invented: real companies,
real signals, real clickable source URLs. A judge who clicks a citation must land on a page
that supports it.

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

- [ ] **0.1 Scaffold the app.** `create-next-app` (TypeScript, App Router, Tailwind), init
  shadcn/ui, add base components (button, input, card, badge, dialog, skeleton). Placeholder
  home page with the product name.
  **Done:** `npm run dev` serves a styled page with shadcn components rendering.
  **Verify:** open localhost — styled placeholder, no console errors.
- [ ] **0.2 Streaming LLM route.** `/api/health` returns `{ ok: true }`. `/api/chat` streams
  an OpenAI completion via the AI SDK (`streamText` → `toUIMessageStreamResponse()`).
  Minimal test UI renders the stream. Create `lib/models.ts` here, pinning the two model ids
  (section 2) after checking them against the OpenAI platform docs.
  **Done:** the local test page shows a response streaming token-by-token (not one blob).
  **Verify:** watch the stream; `curl /api/health` returns 200.
- [ ] **0.3 Supabase schema + server client.** Server-only Supabase client using the secret
  (service-role) key (all DB access stays server-side; env var not `NEXT_PUBLIC_`-prefixed).
  One migration implementing the section 3 schema, applied via `supabase db push`. A
  temporary test route inserts and reads back a row.
  **Done:** tables exist; the round-trip works from a route.
  **Verify:** rows visible in the Supabase dashboard.
- [ ] **0.4 Deploy.** Push to the GitHub repo, import to Vercel, set env vars
  (`OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`).
  **Done (tier gate):** the production URL streams `/api/chat` and `/api/health` is green —
  verified on the live URL, not localhost.

### Tier 1 — Thesis onboarding
Gate: a saved thesis object drives a downstream call.

- [ ] **1.1 Onboarding form.** Fields: stage, industries (multi-select), min traction,
  demographic prefs, free-text thesis. Zod-validated; persists to `theses` via a server
  action.
  **Done:** submitting creates a `theses` row matching the inputs.
  **Verify:** the form is completable in ~15 seconds (demo step 1 pace).
- [ ] **1.2 Two theses + active selector.** Seed two contrasting theses (pre-seed deeptech;
  Series A consumer). Header selector sets the active thesis, readable server-side.
  **Done:** switching the selector changes which thesis id downstream calls receive.
  **Verify:** inspect a downstream call after switching — the id changes.

### Tier 2 — Scoring engine
Gate: every seed company has a score with linked signals, and rankings reorder between the
two theses.

- [ ] **2.1 Research the seed dataset (agents).** Research agents compile 30–50 real
  companies with real signals (section 4) into a typed data file: each company ≥2 signals,
  every signal a real `source_url`, ≥5 companies with genuinely non-obvious pass-reason
  material, sectors/stages spread so the two theses rank them differently.
  **Done:** a small validation script confirms shape (URL format, valid signal kinds, counts).
  **Verify:** spot-click 10 random source URLs — each loads and supports its signal.
- [ ] **2.2 Seed script.** Idempotent `npm run seed` populating `companies` + `signals`
  (upsert; re-run safe). Also seeds the two theses if absent.
  **Done:** DB matches the data file; re-running does not duplicate rows.
- [ ] **2.3 `scoreCompany(thesis, signals)`.** Structured JSON output via the AI SDK
  (`generateText` + `Output.object({ schema })` — see stack gotchas), validated with the
  section 5 zod schema. Prompt per section 5; retry on invalid output.
  **Done:** three hand-picked sample companies return valid JSON with specific, falsifiable
  pass reasons and `contributing_signal_ids` ⊆ the input signal ids.
  **Verify:** read the outputs — "the market is competitive"-grade reasons are bugs.
- [ ] **2.4 Batch scoring.** Score the whole seed set against the active thesis
  (concurrency-limited), persisting to `scores`.
  **Done:** a `scores` row per company for the active thesis, each with non-empty
  `contributing_signal_ids`.
- [ ] **2.5 Re-score on thesis switch + reorder check.** Switching the active thesis scores
  (or reuses cached scores for) that thesis. A quick script/route prints top-10 by fit for
  both theses.
  **Done (tier gate):** both theses fully scored; the two top-10 lists differ meaningfully
  and the differences are explainable by the thesis contents.

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

### Tier 4 — Live discovery timelapse (nice-to-have)
Gate: the agent adds ≥1 new scored node live without breaking anything.

- [ ] **4.1 Discovery pipeline.** Server route: fetch + parse a small fixed source list →
  extract candidate company + signals with the cheap model → insert → score with the main
  model → return the new node. Timeouts and failure isolation: any error leaves existing
  data untouched.
  **Done:** invoking discovery inserts ≥1 new company with signals and a score.
- [ ] **4.2 Discovery UI.** "Run discovery" control; streaming log of agent steps; the new
  node drops into the map and settles.
  **Done:** demo step 3 works on camera; killing the network mid-run breaks nothing already
  on screen.

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
3. (Tier 4) kick off live discovery; a new company node drops in and scores on camera.
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
