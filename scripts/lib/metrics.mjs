/**
 * Readers for the machine-readable output of each test tier.
 *
 * One module, because three scripts need the same numbers and they must agree:
 * `record-metrics.mjs` writes them to the history file, `build-report-site.mjs`
 * puts them on the published index, and `render-load-report.mjs` renders the
 * load run. A second implementation of "what is the mutation score" is a second
 * chance to state it differently — the failure mode `check-doc-counts.mjs`
 * already documents, one level up.
 *
 * Every reader returns `null` when its input is absent. A missing tier is a
 * normal state here (the load job merges in after the row exists, the mutation
 * job runs only on `main`), and the difference between "not measured" and "measured as zero"
 * must survive into the history file.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Where the history lives. In CI it is `metrics.jsonl` on the `metrics` branch,
 * checked out beside the working tree, so recording a run never adds a commit
 * to `main`; the workflow points here with `METRICS_HISTORY`. Locally the
 * default is an untracked scratch file.
 */
export const HISTORY_FILE = process.env.METRICS_HISTORY ?? "reports/history/metrics.jsonl";

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path} is not readable JSON: ${error.message}`);
  }
}

/**
 * v8 coverage totals, from the `json-summary` reporter.
 *
 * Scoped to `src/lib` by `vite.config.ts` — see the comment there for why a
 * repo-wide figure would be a bigger number and a weaker claim.
 */
export function readCoverage(path = "coverage/coverage-summary.json") {
  const json = readJson(path);
  if (!json?.total) return null;
  const pct = (key) => json.total[key]?.pct ?? null;
  return {
    lines: pct("lines"),
    statements: pct("statements"),
    functions: pct("functions"),
    branches: pct("branches"),
  };
}

/**
 * Mutation score from Stryker's JSON report.
 *
 * Computed here rather than read off the HTML, and computed the standard way:
 * `(killed + timeout) / (killed + timeout + survived + no-coverage)`. Mutants
 * Stryker could not run — compile errors, ignored — are excluded from both
 * sides, because counting them either way describes the runner rather than the
 * suite.
 */
export function readMutation(path = "reports/mutation/mutation.json") {
  const json = readJson(path);
  if (!json?.files) return null;

  const byStatus = {};
  for (const file of Object.values(json.files)) {
    for (const mutant of file.mutants ?? []) {
      byStatus[mutant.status] = (byStatus[mutant.status] ?? 0) + 1;
    }
  }

  const killed = (byStatus.Killed ?? 0) + (byStatus.Timeout ?? 0);
  const survived = (byStatus.Survived ?? 0) + (byStatus.NoCoverage ?? 0);
  const detected = killed + survived;

  return {
    score: detected === 0 ? null : Math.round((killed / detected) * 10000) / 100,
    killed: byStatus.Killed ?? 0,
    timeout: byStatus.Timeout ?? 0,
    survived: byStatus.Survived ?? 0,
    no_coverage: byStatus.NoCoverage ?? 0,
    total: detected,
    files: Object.keys(json.files).length,
  };
}

/**
 * The Web Vitals tier, from `tests/e2e/flows/web-vitals.spec.ts`.
 *
 * Recorded, never gated — the spec's own header explains why a threshold on a
 * dev-server LCP would only teach people to re-run the build. The history file
 * is where it becomes useful: a regression shows up as a number moving against
 * the previous runs on the same `source`, which is the same argument this repo
 * already makes for the mutation score.
 *
 * Reduced to the worst page per metric. A per-page breakdown stays in the
 * spec's own JSON; a one-line-per-commit history wants the figure that would
 * make someone look.
 */
export function readVitals(path = "reports/vitals/vitals.json") {
  const json = readJson(path);
  if (!Array.isArray(json?.pages) || json.pages.length === 0) return null;

  const worst = (key) => {
    const values = json.pages.map((p) => p[key]).filter((v) => typeof v === "number");
    return values.length === 0 ? null : Math.max(...values);
  };

  return {
    lcp_ms: worst("lcp_ms"),
    fcp_ms: worst("first_contentful_paint_ms"),
    dom_content_loaded_ms: worst("dom_content_loaded_ms"),
    load_event_ms: worst("load_event_ms"),
    pages: json.pages.length,
    source: json.source ?? null,
  };
}

/** Every `<scenario>.summary.json` k6 wrote, in filename order. */
export function readLoadSummaries(dir = "reports/load") {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".summary.json"))
    .sort()
    .map((f) => readJson(join(dir, f)))
    .filter(Boolean);
}

/**
 * The load tier, flattened to the handful of figures worth tracking over time.
 *
 * The full run stays in the summary JSON and the published page; this is what
 * belongs in a one-line-per-commit history.
 */
export function readLoad(dir = "reports/load") {
  const summaries = readLoadSummaries(dir);
  if (summaries.length === 0) return null;

  const load = { scenarios: {} };
  for (const s of summaries) {
    load.scenarios[s.scenario] = {
      p95_ms: s.http?.p95_ms ?? null,
      requests: s.http?.requests ?? null,
      checks_passed: s.checks?.passes ?? null,
      checks_failed: s.checks?.fails ?? null,
      thresholds_ok: s.thresholds?.every((t) => t.ok === true) ?? null,
      counters: s.counters ?? {},
    };
  }
  return load;
}

/** The history file, oldest first. Tolerates a trailing newline and blank lines. */
export function readHistory(path = HISTORY_FILE) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${path}:${i + 1} is not valid JSON — ${error.message}`);
      }
    });
}

/** `2026-09-02T10:11:12.000Z` → `2026-09-02`. */
export function day(iso) {
  return typeof iso === "string" ? iso.slice(0, 10) : "";
}

export function pct(value, digits = 2) {
  return typeof value === "number" ? `${value.toFixed(digits)}%` : "—";
}

export function ms(value) {
  return typeof value === "number" ? `${Math.round(value)} ms` : "—";
}

/**
 * Where each measurement stands at the latest run, and the range it has held.
 *
 * The range is the half that answers the obvious question about a single
 * number: whether 99.54% is a stable property of the suite or one lucky run.
 * Latency is ranged over CI rows only — a `local` row includes a developer
 * machine's round-trip to Supabase, so mixing the two measures the network.
 * Returns `null` when nothing has been recorded yet.
 */
export function summarizeHistory(rows) {
  // A row whose only measurement is `load` is merged into its commit's row by
  // the recorder, so this filter only drops rows with nothing to show.
  const measured = rows.filter((row) => row.coverage || row.mutation || row.vitals);
  if (measured.length === 0) return null;

  const latest = measured[measured.length - 1];
  const joinP95 = (r) => r.load?.scenarios?.["join-flow"]?.p95_ms;

  const range = (pick) => {
    const values = measured.map(pick).filter((v) => typeof v === "number");
    return values.length ? { min: Math.min(...values), max: Math.max(...values) } : null;
  };
  const span = (label, r, fmt, steady) =>
    r === null
      ? null
      : r.min === r.max
        ? `${label} ${fmt(r.min)}${steady}`
        : `${label} ${fmt(r.min)} – ${fmt(r.max)}`;

  return {
    runs: measured.length,
    first: day(measured[0].date),
    latest: {
      date: day(latest.date),
      source: latest.source === "ci" ? "CI" : "a developer machine",
      coverage: latest.coverage ? pct(latest.coverage.lines, 0) : "—",
      mutation: latest.mutation
        ? `${pct(latest.mutation.score)} (${latest.mutation.killed}/${latest.mutation.total})`
        : "—",
      lcp: latest.vitals ? ms(latest.vitals.lcp_ms) : "—",
      join: typeof joinP95(latest) === "number" ? ms(joinP95(latest)) : "—",
    },
    spans: [
      span("coverage", range((r) => r.coverage?.lines), (v) => pct(v, 0), " throughout"),
      span("mutation", range((r) => r.mutation?.score), (v) => pct(v), " on every run"),
      span("worst LCP", range((r) => (r.source === "ci" ? r.vitals?.lcp_ms : undefined)), (v) => ms(v), " on every CI run"),
      span("join burst p95", range((r) => (r.source === "ci" ? joinP95(r) : undefined)), (v) => ms(v), " on every CI run"),
    ].filter(Boolean),
  };
}
