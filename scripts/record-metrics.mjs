#!/usr/bin/env node
/**
 * Append one run's measurements to the metrics history.
 *
 * The problem this solves: coverage, the mutation score and the k6 baselines
 * are *measurements*, and this repo argues that a measurement is watched by
 * comparing runs rather than by gating on a threshold picked in advance
 * (`TEST_STRATEGY.md` → "Why there is no CI gate"). That only holds if the runs
 * are still there to compare, and a CI artefact expires after 30 days.
 *
 * The history is one JSON object per commit. In CI it is `metrics.jsonl` on the
 * `metrics` branch — versioned, diffable, and kept off `main`, so recording a
 * run never adds a commit to the branch people read. The published site renders
 * it (`build-report-site.mjs`).
 *
 * Usage:
 *   node scripts/record-metrics.mjs                    # whatever is on disk
 *   node scripts/record-metrics.mjs --dry-run          # print, write nothing
 *   node scripts/record-metrics.mjs --history path/to/metrics.jsonl
 *
 * Records only the tiers whose output is present, and merges into the existing
 * row for the same commit rather than adding a second one.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import {
  HISTORY_FILE,
  readCoverage,
  readMutation,
  readLoad,
  readVitals,
  readHistory,
} from "./lib/metrics.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

// ─── arguments ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function flag(name, fallback = null) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
}
const DRY_RUN = args.includes("--dry-run");
const HISTORY = flag("history", HISTORY_FILE);

function currentSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function currentRef() {
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function runUrl() {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  if (!GITHUB_SERVER_URL || !GITHUB_REPOSITORY || !GITHUB_RUN_ID) return null;
  return `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
}

const sha = flag("sha", currentSha());
if (!sha) {
  console.error("No commit SHA: pass --sha, or run inside a git checkout.");
  process.exit(1);
}

// `local` matters when reading the file back. A latency measured on a developer
// machine includes that machine's round-trip to Supabase and is not comparable
// with a runner's — the caveat already written into the k6 baselines, made
// machine-readable so a future comparison cannot silently mix the two.
const source = flag("source", process.env.GITHUB_ACTIONS ? "ci" : "local");

// ─── collect ─────────────────────────────────────────────────────────────────

const measured = {
  coverage: readCoverage(flag("coverage", "coverage/coverage-summary.json")),
  mutation: readMutation(flag("mutation", "reports/mutation/mutation.json")),
  load: readLoad(flag("load", "reports/load")),
  vitals: readVitals(flag("vitals", "reports/vitals/vitals.json")),
};

const present = Object.entries(measured).filter(([, v]) => v !== null);
if (present.length === 0) {
  console.error(
    "Nothing to record: no coverage summary, no mutation report, no load summaries " +
      "and no vitals on disk.\n" +
      "Run one of `npm run test:coverage`, `npm run test:mutation`, a k6 scenario, or " +
      "`npx playwright test tests/e2e/flows/web-vitals.spec.ts` first."
  );
  process.exit(1);
}

const now = new Date().toISOString();
const entry = {
  sha: sha.slice(0, 40),
  date: now,
  ref: flag("ref", currentRef()),
  source,
  run: flag("run-url", runUrl()),
};
for (const [tier, values] of present) {
  entry[tier] = { ...values, measured_at: now };
}

// ─── merge ───────────────────────────────────────────────────────────────────
// Keyed by full SHA. A second run on the same commit updates the tiers it
// measured and leaves the others alone, so a dispatched load run adds its
// numbers to the row the push already created instead of opening a second one.

const history = readHistory(HISTORY);
const existing = history.find((row) => row.sha === entry.sha);
if (existing) {
  Object.assign(existing, entry, { date: existing.date });
} else {
  history.push(entry);
}
history.sort((a, b) => String(a.date).localeCompare(String(b.date)));

const jsonl = history.map((row) => JSON.stringify(row)).join("\n") + "\n";

// ─── write ───────────────────────────────────────────────────────────────────

if (DRY_RUN) {
  console.log(JSON.stringify(entry, null, 2));
} else {
  mkdirSync(dirname(HISTORY), { recursive: true });
  writeFileSync(HISTORY, jsonl);
}

console.log(
  `${DRY_RUN ? "[dry run] " : ""}${existing ? "Updated" : "Recorded"} ${entry.sha.slice(0, 7)} ` +
    `(${present.map(([t]) => t).join(", ")}) → ${HISTORY}, ${history.length} runs on file`
);
