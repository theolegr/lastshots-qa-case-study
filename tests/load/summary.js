// @covers none — shared `handleSummary` writer imported by the scenarios; not a scenario itself
/**
 * Shared `handleSummary` for the k6 scenarios.
 *
 * Why this exists: until 2026-09-02 both load scripts produced nothing but
 * console output. The thresholds were asserted and the *numbers* lived only in
 * a job log that scrolls away — so the baselines in `TEST_RESULTS.md` had to be
 * copied by hand, and comparing two runs meant reading two logs side by side.
 *
 * Two files come out of every run:
 *
 *   reports/load/<id>.summary.json   a distilled, stable shape (schema below)
 *   reports/load/<id>.raw.json       k6's own `data` object, verbatim
 *
 * The distilled file is the contract: `scripts/render-load-report.mjs` renders
 * it and `scripts/record-metrics.mjs` appends it to the metrics history. It is
 * deliberately *not* k6's raw dump — that shape changes between k6 versions,
 * and a history file whose meaning depends on which runner wrote a given row is
 * not a history. The raw dump is kept beside it so nothing is lost.
 *
 * No remote imports (`jslib.k6.io`) on purpose: a load test that needs the
 * network to *format its own output* can fail for a reason that has nothing to
 * do with what it measures.
 */

const SCHEMA = 1;

/** k6 has used both an array and a name-keyed object for `groups`/`checks`. */
function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : Object.values(value);
}

/** Depth-first walk of the group tree, flattening every check into one list. */
function collectChecks(group, out = []) {
  for (const check of asArray(group?.checks)) {
    out.push({
      name: check.name,
      passes: check.passes ?? 0,
      fails: check.fails ?? 0,
    });
  }
  for (const child of asArray(group?.groups)) collectChecks(child, out);
  return out;
}

function values(data, metric) {
  return data?.metrics?.[metric]?.values ?? {};
}

function round(n, digits = 0) {
  if (typeof n !== "number" || !isFinite(n)) return null;
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

/**
 * Every threshold declared in `options`, with its verdict.
 *
 * k6 reports `{ ok: boolean }` per threshold expression; older builds used
 * `{ passes, fails }`. Both are read, and an unrecognised shape yields `null`
 * rather than a confident `false` — a report that invents a failure is worse
 * than one that says it could not tell.
 */
function collectThresholds(data) {
  const out = [];
  for (const [metric, entry] of Object.entries(data?.metrics ?? {})) {
    for (const [expression, verdict] of Object.entries(entry?.thresholds ?? {})) {
      let ok = null;
      if (typeof verdict?.ok === "boolean") ok = verdict.ok;
      else if (typeof verdict?.fails === "number") ok = verdict.fails === 0;
      out.push({ metric, threshold: expression, ok });
    }
  }
  return out;
}

function distil(scenario, data) {
  const duration = values(data, "http_req_duration");
  const reqs = values(data, "http_reqs");
  const failed = values(data, "http_req_failed");
  const iterations = values(data, "iterations");
  const vus = values(data, "vus_max");

  const checks = collectChecks(data?.root_group);
  // The scenario's own counters — `vote_inserts_201`, `vote_duplicates_409`.
  // k6's built-ins are excluded: they are either reported in their own field
  // above or say nothing about the run's outcome, and mixing them in makes the
  // custom ones harder to find in the very place they matter.
  const BUILT_IN_COUNTERS = new Set(["iterations", "dropped_iterations", "checks"]);
  const counters = {};
  for (const [name, entry] of Object.entries(data?.metrics ?? {})) {
    const builtIn =
      BUILT_IN_COUNTERS.has(name) || name.startsWith("http_") || name.startsWith("data_");
    if (entry?.type === "counter" && !builtIn) {
      counters[name] = entry.values?.count ?? 0;
    }
  }

  return {
    schema: SCHEMA,
    scenario: scenario.id,
    title: scenario.title,
    models: scenario.models,
    generated_at: new Date().toISOString(),
    duration_ms: round(data?.state?.testRunDurationMs),
    vus_max: vus.value ?? null,
    iterations: iterations.count ?? null,
    http: {
      requests: reqs.count ?? null,
      // Share of requests k6 considers failed. Read the scenario's own note
      // before treating a high value as a defect — `concurrent-voting` expects
      // ~93%, because a 409 is the constraint doing its job.
      failed_rate: round(failed.rate, 4),
      avg_ms: round(duration.avg, 1),
      p95_ms: round(duration["p(95)"], 1),
      max_ms: round(duration.max, 1),
    },
    checks: {
      passes: checks.reduce((n, c) => n + c.passes, 0),
      fails: checks.reduce((n, c) => n + c.fails, 0),
      list: checks,
    },
    thresholds: collectThresholds(data),
    counters,
    notes: scenario.notes ?? [],
  };
}

/** Fixed-width console block, in place of k6's default summary. */
function render(summary) {
  const lines = [];
  const pad = (label) => `${label}:`.padEnd(28);
  // A scenario that made no HTTP request has no latency, and printing `0.00%`
  // or `null` for it invites a reader to compare a number that was never taken.
  const or = (value, suffix = "") => (value === null || value === undefined ? "—" : `${value}${suffix}`);

  lines.push("");
  lines.push(`  ── ${summary.title} (${summary.scenario}) ${"─".repeat(Math.max(0, 40 - summary.title.length))}`);
  lines.push("");
  lines.push(
    `  ${pad("duration")}${or(summary.duration_ms, " ms")}, ${or(summary.vus_max)} VUs, ` +
      `${or(summary.iterations)} iterations`
  );
  lines.push(`  ${pad("http requests")}${or(summary.http.requests)}`);
  lines.push(
    `  ${pad("latency avg/p95/max")}${or(summary.http.avg_ms)} / ${or(summary.http.p95_ms)} / ` +
      `${or(summary.http.max_ms)} ms`
  );
  lines.push(
    `  ${pad("http_req_failed")}${
      typeof summary.http.failed_rate === "number"
        ? `${(summary.http.failed_rate * 100).toFixed(2)}%`
        : "—"
    }`
  );
  lines.push(`  ${pad("checks")}${summary.checks.passes} passed, ${summary.checks.fails} failed`);
  for (const check of summary.checks.list) {
    const mark = check.fails === 0 ? "✓" : "✗";
    lines.push(`      ${mark} ${check.name} — ${check.passes}/${check.passes + check.fails}`);
  }
  for (const [name, count] of Object.entries(summary.counters)) {
    lines.push(`  ${pad(name)}${count}`);
  }
  lines.push("");
  for (const t of summary.thresholds) {
    const mark = t.ok === true ? "✓" : t.ok === false ? "✗" : "?";
    lines.push(`  ${mark} threshold  ${t.metric} ${t.threshold}`);
  }
  for (const note of summary.notes) {
    lines.push(`  note: ${note}`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Build the `handleSummary` return value.
 *
 * `reports/load/` must exist before the run — k6 writes the files but does not
 * create their directory. CI does it in the step; locally, `mkdir -p`.
 */
export function buildSummary(scenario, data) {
  const summary = distil(scenario, data);
  return {
    stdout: render(summary),
    [`reports/load/${scenario.id}.summary.json`]: JSON.stringify(summary, null, 2),
    [`reports/load/${scenario.id}.raw.json`]: JSON.stringify(data, null, 2),
  };
}
