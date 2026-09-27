#!/usr/bin/env node
/**
 * Render the k6 summaries into one HTML page.
 *
 * k6 has no built-in HTML report, and the community one (`k6-reporter`) is a
 * remote import evaluated inside the test run — a load test that reaches the
 * network to format its own output can fail for a reason unrelated to what it
 * measures. So the scenarios write JSON (`tests/load/summary.js`) and the
 * rendering happens here, afterwards, where a failure costs nothing.
 *
 * Usage:
 *   node scripts/render-load-report.mjs [inputDir] [outputFile]
 *   defaults: reports/load  →  reports/load/index.html
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readLoadSummaries, day } from "./lib/metrics.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const escape = (value) =>
  String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const num = (value, unit = "") =>
  typeof value === "number" ? `${value.toLocaleString("en-US")}${unit}` : "—";

function verdict(ok) {
  if (ok === true) return `<span class="ok">pass</span>`;
  if (ok === false) return `<span class="fail">fail</span>`;
  return `<span class="unknown">not reported</span>`;
}

function scenarioSection(s) {
  const checks = (s.checks?.list ?? [])
    .map(
      (c) =>
        `<tr><td>${escape(c.name)}</td><td class="n">${num(c.passes)}</td><td class="n">${num(c.fails)}</td>` +
        `<td>${verdict(c.fails === 0)}</td></tr>`
    )
    .join("\n");

  const thresholds = (s.thresholds ?? [])
    .map(
      (t) =>
        `<tr><td><code>${escape(t.metric)}</code></td><td><code>${escape(t.threshold)}</code></td>` +
        `<td>${verdict(t.ok)}</td></tr>`
    )
    .join("\n");

  const counters = Object.entries(s.counters ?? {})
    .map(([name, count]) => `<tr><td><code>${escape(name)}</code></td><td class="n">${num(count)}</td></tr>`)
    .join("\n");

  return `
<section>
  <h2>${escape(s.title ?? s.scenario)} <span class="id">${escape(s.scenario)}</span></h2>
  ${s.models ? `<p class="models">Models: ${escape(s.models)}</p>` : ""}
  <p class="meta">Run ${escape(day(s.generated_at))} · ${num(s.vus_max)} VUs ·
     ${num(s.iterations)} iterations · ${num(s.duration_ms, " ms")}</p>

  <div class="cards">
    <div class="card"><span class="k">requests</span><span class="v">${num(s.http?.requests)}</span></div>
    <div class="card"><span class="k">p95 latency</span><span class="v">${num(s.http?.p95_ms, " ms")}</span></div>
    <div class="card"><span class="k">avg latency</span><span class="v">${num(s.http?.avg_ms, " ms")}</span></div>
    <div class="card"><span class="k">max latency</span><span class="v">${num(s.http?.max_ms, " ms")}</span></div>
    <div class="card"><span class="k">http_req_failed</span><span class="v">${
      typeof s.http?.failed_rate === "number" ? `${(s.http.failed_rate * 100).toFixed(2)}%` : "—"
    }</span></div>
    <div class="card"><span class="k">checks</span><span class="v">${num(s.checks?.passes)} / ${num(
      (s.checks?.passes ?? 0) + (s.checks?.fails ?? 0)
    )}</span></div>
  </div>

  ${
    (s.notes ?? []).length > 0
      ? `<div class="note"><strong>Read this before the numbers.</strong> ${s.notes
          .map(escape)
          .join(" ")}</div>`
      : ""
  }

  <h3>Thresholds</h3>
  <table><thead><tr><th>Metric</th><th>Expression</th><th>Verdict</th></tr></thead>
  <tbody>${thresholds || `<tr><td colspan="3">None declared.</td></tr>`}</tbody></table>

  <h3>Checks</h3>
  <table><thead><tr><th>Check</th><th class="n">Passed</th><th class="n">Failed</th><th>Verdict</th></tr></thead>
  <tbody>${checks || `<tr><td colspan="4">None recorded.</td></tr>`}</tbody></table>

  ${
    counters
      ? `<h3>Custom counters</h3>
  <table><thead><tr><th>Counter</th><th class="n">Count</th></tr></thead><tbody>${counters}</tbody></table>`
      : ""
  }
</section>`;
}

export function renderLoadReport(summaries) {
  const dates = summaries.map((s) => day(s.generated_at)).filter(Boolean).sort();
  const when = dates.length > 0 ? dates[dates.length - 1] : "unknown date";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LastShots — load test report</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 system-ui, sans-serif; max-width: 60rem; margin: 3rem auto; padding: 0 1.5rem; }
  h1 { margin-bottom: .25rem; }
  h2 { margin-top: 2.5rem; border-bottom: 1px solid #8884; padding-bottom: .3rem; }
  h2 .id { font: .7em ui-monospace, monospace; opacity: .6; }
  a { color: #0645ad; }
  p.meta, p.models { opacity: .75; margin: .25rem 0; }
  .cards { display: flex; flex-wrap: wrap; gap: .75rem; margin: 1.25rem 0; }
  .card { border: 1px solid #8884; border-radius: .5rem; padding: .6rem .9rem; min-width: 8.5rem; }
  .card .k { display: block; font-size: .8rem; opacity: .7; }
  .card .v { display: block; font-size: 1.25rem; font-variant-numeric: tabular-nums; }
  table { border-collapse: collapse; width: 100%; margin: .5rem 0 1.5rem; }
  th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid #8883; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
  .ok { color: #0a7d33; font-weight: 600; }
  .fail { color: #b3261e; font-weight: 600; }
  .unknown { opacity: .6; }
  .note { border-left: 3px solid #d0a215; padding: .6rem .9rem; background: #d0a2151a; margin: 1rem 0; }
  footer { margin-top: 3rem; font-size: .9rem; opacity: .75; }
</style></head>
<body>
<h1>Load tests — k6</h1>
<p class="meta">Latest recorded run: ${escape(when)}. Both scenarios hit a real Supabase project;
   they run after the E2E suite on every push to <code>main</code>, never beside it.</p>
<p><a href="../">← all test evidence</a></p>
${summaries.map(scenarioSection).join("\n")}
<footer>
  Generated by <code>scripts/render-load-report.mjs</code> from the JSON each scenario writes in
  <code>handleSummary</code>. The full k6 dump is kept beside it as <code>&lt;scenario&gt;.raw.json</code>,
  and the headline figures are appended to the metrics history (<code>metrics.jsonl</code> on the
  <code>metrics</code> branch), which outlives this page's 30-day artefact retention.
</footer>
</body></html>
`;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const inputDir = process.argv[2] ?? join(ROOT, "reports/load");
  const outputFile = process.argv[3] ?? join(inputDir, "index.html");

  const summaries = readLoadSummaries(inputDir);
  if (summaries.length === 0) {
    console.error(`No *.summary.json in ${inputDir} — run a k6 scenario first.`);
    process.exit(1);
  }

  mkdirSync(dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, renderLoadReport(summaries));
  console.log(
    `Rendered ${summaries.length} scenario(s) → ${outputFile} ` +
      `(${summaries.map((s) => s.scenario).join(", ")})`
  );
}
