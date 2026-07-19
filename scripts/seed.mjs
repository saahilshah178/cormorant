// Idempotent seed script (PLAN.md 2.2): `npm run seed`.
// Upserts the two contrasting demo theses and the pre-indexed company/signal
// dataset from lib/seed-data.json. Re-run safe: companies match on name,
// signals on (company_id, kind, source_url), theses on name — no duplicates.
//
// Plain Node (no tsx/dotenv deps): reads .env.local itself.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvLocal() {
  const path = join(root, ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}
loadEnvLocal();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SECRET_KEY (.env.local).");
  process.exit(1);
}
const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// The two contrasting demo theses (PLAN.md 1.2). Seeded if absent, matched by
// name — the demo depends on these two reordering the same company pool.
const THESES = [
  {
    name: "Pre-seed deeptech",
    stages: ["pre_seed", "seed"],
    industries: ["ai_infra", "robotics", "biotech", "space", "defense", "climate"],
    min_traction:
      "Working prototype or credible technical demo; revenue not required.",
    demographics_pref:
      "Technical founding team; at least one founder with deep domain research or engineering background.",
    raw_thesis_text:
      "We invest at pre-seed and seed in deeptech: AI infrastructure, robotics, biotech tools, space, defense, and climate hardware. We back technical founders attacking hard engineering or science problems with defensible IP. The depth of the technical moat and the caliber of the team matter far more than current revenue. We avoid thin application layers over commodity models, late-stage rounds, and pure consumer plays.",
  },
  {
    name: "Series A consumer",
    stages: ["series_a"],
    industries: ["consumer", "fintech", "healthcare"],
    min_traction:
      "At least $1M ARR or 100K+ monthly active users with strong retention.",
    demographics_pref:
      "Founders with a consumer growth, brand, or marketplace track record.",
    raw_thesis_text:
      "We lead Series A rounds in consumer products: consumer apps, consumer fintech, and consumer health. We need demonstrated product-market fit — retention cohorts, organic growth, real unit economics — and a credible path to a mass-market brand. We pass on pre-revenue deeptech, capital-intensive hardware, and anything without live consumer traction.",
  },
];

async function seedTheses() {
  let created = 0;
  for (const t of THESES) {
    const { data, error } = await db
      .from("theses")
      .select("id")
      .eq("name", t.name)
      .maybeSingle();
    if (error) throw new Error(`theses select: ${error.message}`);
    if (data) continue;
    const { error: insErr } = await db.from("theses").insert(t);
    if (insErr) throw new Error(`theses insert: ${insErr.message}`);
    created++;
  }
  console.log(`theses: ${created} created, ${THESES.length - created} already present`);
}

async function seedCompanies() {
  const dataPath = join(root, "lib", "seed-data.json");
  if (!existsSync(dataPath)) {
    console.warn(
      "lib/seed-data.json not found — seeded theses only. Run again once the dataset exists.",
    );
    return;
  }
  const companies = JSON.parse(readFileSync(dataPath, "utf8"));

  let companiesCreated = 0;
  let companiesUpdated = 0;
  let signalsCreated = 0;
  let signalsSkipped = 0;

  for (const c of companies) {
    // No user_id: seed companies are the shared demo pool (user_id IS NULL),
    // visible to every signed-in VC. Only discovered companies get an owner.
    const companyRow = {
      name: c.name,
      website: c.website ?? null,
      github_url: c.github_url ?? null,
      sector: c.sector ?? null,
      stage: c.stage ?? null,
      source: "seed-dataset",
    };

    const { data: existing, error: selErr } = await db
      .from("companies")
      .select("id")
      .eq("name", c.name)
      .maybeSingle();
    if (selErr) throw new Error(`companies select ${c.name}: ${selErr.message}`);

    let companyId;
    if (existing) {
      companyId = existing.id;
      const { error } = await db
        .from("companies")
        .update(companyRow)
        .eq("id", companyId);
      if (error) throw new Error(`companies update ${c.name}: ${error.message}`);
      companiesUpdated++;
    } else {
      const { data, error } = await db
        .from("companies")
        .insert(companyRow)
        .select("id")
        .single();
      if (error) throw new Error(`companies insert ${c.name}: ${error.message}`);
      companyId = data.id;
      companiesCreated++;
    }

    for (const s of c.signals) {
      const { data: sig, error: sigSelErr } = await db
        .from("signals")
        .select("id")
        .eq("company_id", companyId)
        .eq("kind", s.kind)
        .eq("source_url", s.source_url)
        .maybeSingle();
      if (sigSelErr)
        throw new Error(`signals select ${c.name}: ${sigSelErr.message}`);
      if (sig) {
        signalsSkipped++;
        continue;
      }
      const { error } = await db.from("signals").insert({
        company_id: companyId,
        kind: s.kind,
        value: s.value,
        source_url: s.source_url,
        confidence: s.confidence ?? null,
      });
      if (error) throw new Error(`signals insert ${c.name}: ${error.message}`);
      signalsCreated++;
    }
  }

  console.log(
    `companies: ${companiesCreated} created, ${companiesUpdated} updated (upsert). ` +
      `signals: ${signalsCreated} created, ${signalsSkipped} already present.`,
  );
}

await seedTheses();
await seedCompanies();
console.log("seed complete");
