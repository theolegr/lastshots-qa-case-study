#!/usr/bin/env node
/**
 * Assemble the published evidence site.
 *
 * Takes a directory holding the reports CI has already downloaded — each in its
 * own subdirectory — renders the load page from the k6 JSON if any is present,
 * and writes the index that ties them together.
 *
 * This used to be a heredoc inside `ci.yml`. It moved here when the site grew
 * past two fixed links: the mutation report is published only when its job ran,
 * and the load report comes from the load job, which may not have uploaded
 * one. Expressing "link it if it exists" in YAML-embedded shell is how a
 * site quietly ends up advertising a 404, and none of it could be checked
 * without pushing. Run it locally and open the result.
 *
 * Usage:
 *   node scripts/build-report-site.mjs [siteDir] [loadJsonDir]
 *   defaults: site  and  reports/load
 */

import { writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { readLoadSummaries, readHistory, summarizeHistory, day, pct, ms } from "./lib/metrics.mjs";
import { renderLoadReport } from "./render-load-report.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

const siteDir = process.argv[2] ?? "site";
const loadJsonDir = process.argv[3] ?? "reports/load";

const escape = (value) =>
  String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** A downloaded artefact directory counts as present only if it has content. */
function hasContent(dir) {
  const full = join(siteDir, dir);
  return existsSync(full) && readdirSync(full).length > 0;
}

// ─── the load page ───────────────────────────────────────────────────────────

const loadSummaries = readLoadSummaries(loadJsonDir);
if (loadSummaries.length > 0) {
  mkdirSync(join(siteDir, "load"), { recursive: true });
  writeFileSync(join(siteDir, "load", "index.html"), renderLoadReport(loadSummaries));
}

// ─── which sections exist ────────────────────────────────────────────────────
// Deliberately data-driven, and deliberately honest about *why* something is
// missing: a section absent with no explanation reads as an oversight, and the
// two that can legitimately be absent are absent by design.

const loadDates = loadSummaries.map((s) => day(s.generated_at)).filter(Boolean).sort();

const sections = [
  {
    dir: "playwright",
    title: "Playwright report",
    blurb:
      "The full E2E suite, run against a real Supabase project under production Row Level Security — " +
      "no mocked database, no service_role bypass. Failures carry a trace.",
    absent: null, // never legitimately absent: publishing is gated on the e2e job
  },
  {
    dir: "coverage",
    title: "Coverage report",
    blurb:
      "<code>src/lib</code> — the pure-logic modules the unit tier is responsible for. " +
      "The 100% thresholds are enforced in CI, not decorative. Scoped on purpose: a repo-wide " +
      "percentage would be a larger number and a weaker claim.",
    absent: null,
  },
  {
    dir: "mutation",
    title: "Mutation report (Stryker)",
    blurb:
      "Coverage says every branch was executed; this says the suite would <em>fail</em> if one were wrong. " +
      "Runs on every push to <code>main</code> — measured, never gated.",
    absent: "Not published for this commit — the Stryker job did not run.",
  },
  {
    dir: "load",
    title: "Load report (k6)",
    blurb:
      "Join burst and vote retry storm, both against real Supabase. " +
      (loadDates.length > 0
        ? `Run after the E2E suite on every push to main; this one is dated ${escape(loadDates[loadDates.length - 1])}.`
        : ""),
    absent:
      "No load report within artefact retention for this run; its headline figures survive in " +
      "the metrics history below.",
  },
];

const present = sections.filter((s) => hasContent(s.dir));

// ─── the history table ───────────────────────────────────────────────────────

const history = readHistory();

function historyRows() {
  return history
    .slice()
    .reverse()
    .slice(0, 20)
    .map((row) => {
      const sha = String(row.sha ?? "").slice(0, 7);
      const commit = row.run ? `<a href="${escape(row.run)}"><code>${escape(sha)}</code></a>` : `<code>${escape(sha)}</code>`;
      const join = row.load?.scenarios?.["join-flow"];
      return `<tr>
        <td>${escape(day(row.date))}</td>
        <td>${commit}</td>
        <td>${escape(row.source ?? "—")}</td>
        <td class="n">${row.coverage ? pct(row.coverage.lines, 0) : "—"}</td>
        <td class="n">${row.mutation ? pct(row.mutation.score) : "—"}</td>
        <td class="n">${join ? ms(join.p95_ms) : "—"}</td>
      </tr>`;
    })
    .join("\n");
}

// Where the history can be read in full: the `metrics` branch of the repository
// this site was built from.
const repo = process.env.GITHUB_REPOSITORY;
const historyLink = repo
  ? `<a href="https://github.com/${escape(repo)}/blob/metrics/metrics.jsonl"><code>metrics.jsonl</code></a> on the <code>metrics</code> branch`
  : "<code>metrics.jsonl</code> on the <code>metrics</code> branch";

const summary = summarizeHistory(history);
const summaryBlock = summary
  ? `<p><strong>Latest run — ${escape(summary.latest.date)}, measured on ${escape(summary.latest.source)}.</strong></p>
<table>
  <thead><tr><th class="n">Coverage <code>src/lib</code></th><th class="n">Mutation</th><th class="n">Worst LCP</th><th class="n">Join burst p95</th></tr></thead>
  <tbody><tr><td class="n">${escape(summary.latest.coverage)}</td><td class="n">${escape(summary.latest.mutation)}</td>
  <td class="n">${escape(summary.latest.lcp)}</td><td class="n">${escape(summary.latest.join)}</td></tr></tbody></table>
<p>Across the ${summary.runs} ${summary.runs === 1 ? "run" : "runs"} on file since ${escape(summary.first)}: ${escape(summary.spans.join(", "))}.</p>`
  : "";

const historyTable =
  history.length === 0
    ? "<p>No runs recorded yet.</p>"
    : `<table>
  <thead><tr><th>Date</th><th>Commit</th><th>Source</th><th class="n">Coverage</th>
  <th class="n">Mutation</th><th class="n">Join p95</th></tr></thead>
  <tbody>
${historyRows()}
  </tbody></table>
<p class="meta">Last ${Math.min(history.length, 20)} of ${history.length} recorded runs.
   The full history is ${historyLink}, kept in git — it outlives the 30-day retention on the
   reports above.</p>`;

// ─── the index ───────────────────────────────────────────────────────────────

const sha = (process.env.GITHUB_SHA ?? "").slice(0, 7);

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LastShots — test evidence</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 system-ui, sans-serif; max-width: 48rem; margin: 3rem auto; padding: 0 1.5rem; }
  a { color: #0645ad; }
  h1 { margin-bottom: .25rem; }
  ul.reports { list-style: none; padding: 0; }
  ul.reports li { border: 1px solid #8884; border-radius: .5rem; padding: .9rem 1.1rem; margin: .75rem 0; }
  ul.reports li.absent { opacity: .65; }
  ul.reports .why { font-size: .9rem; }
  table { border-collapse: collapse; width: 100%; margin: .5rem 0 1rem; }
  th, td { text-align: left; padding: .35rem .6rem; border-bottom: 1px solid #8883; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
  p.meta { opacity: .75; font-size: .9rem; }
  footer { margin-top: 3rem; font-size: .9rem; opacity: .75; }
</style></head>
<body>
<h1>LastShots — test evidence</h1>
<p class="meta">Regenerated on every push to <code>main</code>${sha ? ` · commit <code>${escape(sha)}</code>` : ""}.
   Source: <a href="https://github.com/theolegr/lastshots-qa-case-study">the repository</a> ·
   the reasoning behind each of these lives in <code>TEST_STRATEGY.md</code>, the runs in <code>TEST_RESULTS.md</code>.</p>

<h2>Reports</h2>
<ul class="reports">
${sections
  .map((s) =>
    hasContent(s.dir)
      ? `  <li><a href="./${s.dir}/"><strong>${s.title}</strong></a><br><span class="why">${s.blurb}</span></li>`
      : `  <li class="absent"><strong>${s.title}</strong> — not available<br><span class="why">${escape(
          s.absent ?? "Not published for this run."
        )}</span></li>`
  )
  .join("\n")}
</ul>

<h2 id="measurements">Measurements over time</h2>
<p>Coverage is gated in CI; the mutation score and the load figures are deliberately not.
   They are watched by comparing runs, which is only meaningful if the runs are kept.</p>
${summaryBlock}
${historyTable}

<footer>Built by <code>scripts/build-report-site.mjs</code>.</footer>
</body></html>
`;

mkdirSync(siteDir, { recursive: true });
writeFileSync(join(siteDir, "index.html"), html);

console.log(
  `Site built in ${siteDir}/ — sections: ${present.map((s) => s.dir).join(", ") || "none"}` +
    `${loadSummaries.length > 0 ? ` (load page rendered from ${loadSummaries.length} scenario(s))` : ""}` +
    `, ${history.length} runs in the history table`
);
