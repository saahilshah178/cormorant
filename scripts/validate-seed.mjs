// Seed-dataset shape validator (PLAN.md 2.1): `npm run seed:validate`.
// Confirms lib/seed-data.json matches the schema the seed script and the
// scoring engine expect. Exits non-zero on any violation.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const path = join(root, "lib", "seed-data.json");

const SECTORS = new Set([
  "ai_infra", "devtools", "consumer", "fintech", "healthcare", "climate",
  "robotics", "biotech", "space", "defense", "enterprise_saas",
]);
const STAGES = new Set(["pre_seed", "seed", "series_a", "series_b"]);
const KINDS = new Set([
  "commit_cadence", "hire", "funding", "customer_mention", "traction",
  "press", "other",
]);

const errors = [];
const warn = [];

const companies = JSON.parse(readFileSync(path, "utf8"));
if (!Array.isArray(companies)) {
  console.error("seed-data.json is not an array");
  process.exit(1);
}

if (companies.length < 30 || companies.length > 50) {
  errors.push(`company count ${companies.length} outside 30-50`);
}

const names = new Set();
let bearCases = 0;
const sectorCounts = {};
const stageCounts = {};

companies.forEach((c, i) => {
  const label = c?.name ?? `#${i}`;
  if (!c.name || typeof c.name !== "string") errors.push(`${label}: missing name`);
  if (names.has(c.name?.toLowerCase())) errors.push(`${label}: duplicate name`);
  names.add(c.name?.toLowerCase());

  if (!/^https?:\/\/.+/.test(c.website ?? "")) errors.push(`${label}: bad website`);
  if (c.github_url != null && !/^https?:\/\/(www\.)?github\.com\//.test(c.github_url))
    errors.push(`${label}: bad github_url`);
  if (!SECTORS.has(c.sector)) errors.push(`${label}: bad sector "${c.sector}"`);
  if (!STAGES.has(c.stage)) errors.push(`${label}: bad stage "${c.stage}"`);

  sectorCounts[c.sector] = (sectorCounts[c.sector] ?? 0) + 1;
  stageCounts[c.stage] = (stageCounts[c.stage] ?? 0) + 1;

  if (!Array.isArray(c.signals) || c.signals.length < 2) {
    errors.push(`${label}: needs >=2 signals, has ${c.signals?.length ?? 0}`);
  } else {
    c.signals.forEach((s, j) => {
      if (!KINDS.has(s.kind)) errors.push(`${label} signal ${j}: bad kind "${s.kind}"`);
      if (!s.value || typeof s.value !== "string" || s.value.length < 10)
        errors.push(`${label} signal ${j}: value missing/too short`);
      if (!/^https?:\/\/.+\..+/.test(s.source_url ?? ""))
        errors.push(`${label} signal ${j}: bad source_url "${s.source_url}"`);
      if (typeof s.confidence !== "number" || s.confidence < 0 || s.confidence > 1)
        errors.push(`${label} signal ${j}: confidence not in [0,1]`);
    });
  }

  if (typeof c.pass_reason_notes === "string" && c.pass_reason_notes.length >= 60)
    bearCases++;
});

if (bearCases < 5)
  errors.push(`only ${bearCases} companies have substantial pass_reason_notes (need >=5)`);

// The two theses must rank the pool differently: require both early deeptech
// and later-stage consumer representation.
const deeptechEarly = companies.filter(
  (c) => ["pre_seed", "seed"].includes(c.stage) &&
    ["ai_infra", "robotics", "biotech", "space", "defense", "climate"].includes(c.sector),
).length;
const consumerLate = companies.filter(
  (c) => ["series_a", "series_b"].includes(c.stage) &&
    ["consumer", "fintech", "healthcare"].includes(c.sector),
).length;
if (deeptechEarly < 6) errors.push(`only ${deeptechEarly} early-stage deeptech companies (need >=6 for thesis contrast)`);
if (consumerLate < 6) errors.push(`only ${consumerLate} later-stage consumer companies (need >=6 for thesis contrast)`);

console.log(`companies: ${companies.length}`);
console.log(`sectors:`, sectorCounts);
console.log(`stages:`, stageCounts);
console.log(`substantial bear-case notes: ${bearCases}`);
console.log(`early deeptech: ${deeptechEarly}, later consumer: ${consumerLate}`);
for (const w of warn) console.warn(`WARN: ${w}`);

if (errors.length) {
  console.error(`\n${errors.length} error(s):`);
  for (const e of errors) console.error(` - ${e}`);
  process.exit(1);
}
console.log("\nseed-data.json is valid");
