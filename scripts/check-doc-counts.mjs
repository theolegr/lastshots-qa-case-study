#!/usr/bin/env node
/**
 * Doc-count guard.
 *
 * A QA portfolio that misstates its own numbers undermines the one thing it is
 * selling: rigor. This script counts what is really on disk and fails if
 * README.md or TEST_STRATEGY.md advertise something different.
 *
 * It guards two families of claim:
 *
 *   1. Test counts — per tier, and the @smoke subset that gates every PR.
 *   2. The bug inventory — every bug listed in TRACEABILITY.md must also be
 *      described in README.md and written up in TEST_RESULTS.md, and the
 *      README's headline count must match.
 *   3. (Retired 2026-09-27.) The generated metrics block in TEST_RESULTS.md.
 *      The block is gone: the history lives on the `metrics` branch and the
 *      published site renders it, so no generated span remains to guard.
 *   4. Cross-references — every relative link between these documents resolves,
 *      file and heading anchor both.
 *   5. One claim that is not a number: that the axe-core scan really does cover
 *      every route README.md says it covers.
 *   6. Traceability — that TRACEABILITY.md's chain from requirement to test to
 *      bug is true of the files on disk, checked in both directions. Added
 *      2026-09-15. See `checkTraceability` below for what it reconciles and for
 *      the two drifts that motivated it.
 *   7. The CI config's own prose. `.github/workflows/*.yml` describes the suite
 *      in comments ("174 unit tests", "38 E2E tests"), and those went stale
 *      because families 1-3 read README.md, TEST_STRATEGY.md and SPECS.md — the CI
 *      config was the one file describing the suite that nothing checked.
 *
 *      Families 4-7 exist because families 1-3 count things and a document
 *      can be wrong without any count being wrong. What they do *not* do is
 *      chase every figure in the prose. A measurement re-taken by a CI job — the
 *      mutation score, the load p95, the Web Vitals — is deliberately left
 *      unguarded and lives in the generated table instead: a guard on it would
 *      turn a legitimate score change into a red build on an already-merged
 *      commit, and a check that goes red on its own teaches people to ignore it.
 *      Family 2 exists because family 1 was not enough: the 2026-08-20 doc
 *      audit found README.md claiming "Four bugs found, all resolved" while
 *      SPECS.md listed six. BUG-005 and BUG-006 had been written up in full,
 *      twice each, and simply never reached the front page. A guard that only
 *      counts `it(` blocks cannot see that.
 *
 * Run locally:   node scripts/check-doc-counts.mjs
 * Run in CI:     wired into the unit job (see .github/workflows/ci.yml)
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const failures = [];

/**
 * Strip comments and string literals before counting, so prose about tests is
 * never mistaken for a test.
 */
function stripNonCode(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/\/\/[^\n]*/g, " ") // line comments
    .replace(/`(?:\\.|[^`\\])*`/g, "``") // template literals
    .replace(/"(?:\\.|[^"\\])*"/g, '""') // double-quoted
    .replace(/'(?:\\.|[^'\\])*'/g, "''"); // single-quoted
}

/**
 * Count test blocks across every .ts file in a directory.
 *
 * The `(?<![.\w])` lookbehind is load-bearing and was added after this guard
 * certified a number that was wrong. The naive pattern `\b(?:it|test)\s*\(`
 * also matches `TIMER_TOAST.test(t)` — a RegExp method call, not a test — which
 * inflated the flow count by one. README.md and TEST_STRATEGY.md advertised "26 tests
 * across 16 files" for months while Playwright reported 25, and the guard
 * confirmed the wrong figure because it repeated the same mistake.
 *
 * The lesson generalises past this script: a check that reimplements the thing
 * it verifies can only catch drift *between* documents, never a shared error.
 * The authority on how many tests exist is Playwright (`--list`); this counter
 * is an approximation kept because it must run in the unit job, which has no
 * browsers and no Supabase credentials. It is now pinned to Playwright's answer
 * by construction — if the two ever disagree again, Playwright is right.
 */
function countTestBlocks(dir) {
  const full = join(ROOT, dir);
  const files = readdirSync(full).filter((f) => f.endsWith(".ts"));
  let blocks = 0;
  for (const file of files) {
    const src = stripNonCode(readFileSync(join(full, file), "utf8"));
    const matches = src.match(/(?<![.\w])(?:it|test)(?:\.(?:only|skip|fixme))?\s*\(/g);
    blocks += matches ? matches.length : 0;
  }
  return { files: files.length, blocks };
}

/**
 * Count the tests in the `@smoke` tier — the subset that gates every PR.
 *
 * Static rather than `playwright test --list`: the guard runs in the unit job,
 * which has no Supabase credentials and must not boot a dev server.
 *
 * Assumes the tag sits on a file's single top-level `describe`, which is how
 * every tagged spec is written today. The assertion below enforces that, so a
 * second describe in a tagged file fails the guard instead of silently
 * miscounting.
 */
function countSmokeBlocks(dirs) {
  let blocks = 0;
  let files = 0;
  for (const dir of dirs) {
    const full = join(ROOT, dir);
    for (const file of readdirSync(full).filter((f) => f.endsWith(".ts"))) {
      const src = readFileSync(join(full, file), "utf8");
      if (!src.includes('tag: "@smoke"')) continue;
      const describes = src.match(/test\.describe\s*\(/g) ?? [];
      if (describes.length !== 1) {
        failures.push(
          `${dir}/${file} carries @smoke but has ${describes.length} describe blocks — ` +
            `the smoke counter assumes exactly one. Tag the tests individually or split the file.`
        );
        continue;
      }
      files += 1;
      blocks += (stripNonCode(src).match(/(?<![.\w])(?:it|test)(?:\.(?:only|skip|fixme))?\s*\(/g) ?? [])
        .length;
    }
  }
  return { files, blocks };
}

/**
 * The bug IDs listed in TRACEABILITY.md's `## Bug → requirement → guard` table,
 * in order.
 *
 * That table is the source of truth for the inventory: one row per bug, and
 * every write-up elsewhere points back at it. It lived in SPECS.md until
 * 2026-09-17, when the bug table left the requirements document for the one
 * that already traced each bug to its requirement and guard. Parsing the table
 * rather than grepping the whole file matters — BUG IDs are referenced in prose
 * all over these documents, so a bare grep would count mentions, not bugs.
 */
function bugsInTraceability(trace) {
  const HEADING = "\n## Bug → requirement → guard\n";
  const start = trace.indexOf(HEADING);
  if (start === -1) {
    failures.push(
      "TRACEABILITY.md has no `## Bug → requirement → guard` section — the bug inventory cannot be checked."
    );
    return [];
  }
  const next = trace.indexOf("\n## ", start + HEADING.length);
  const section = trace.slice(start, next === -1 ? undefined : next);
  const ids = [...section.matchAll(/^\|\s*\*\*(BUG-\d{3})\*\*/gm)].map((m) => m[1]);
  return [...new Set(ids)];
}

/** Small-number words, because the README's prose reads better than "6 bugs". */
const NUMBER_WORDS = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six",
  "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
];

const unit = countTestBlocks("tests/unit");
const flows = countTestBlocks("tests/e2e/flows");
const journeys = countTestBlocks("tests/e2e/journeys");

const smoke = countSmokeBlocks(["tests/e2e/flows", "tests/e2e/journeys"]);

/**
 * Every spec that opens a browser context must release it from `afterEach`.
 *
 * `party-setup.ts` hands out contexts from a module-level registry and
 * `closeOpenContexts` drains it. A spec that opens one without wiring the
 * cleanup leaks a page that keeps a Supabase session, a realtime subscription
 * and a 1s countdown interval alive for the rest of the worker — which makes
 * every *later* test likelier to fail, in a file that itself stays green.
 *
 * That is not hypothetical. The 2026-08-19 fix added the afterEach to seven
 * spec files and missed `settings-immutable.spec.ts`; the miss surfaced a day
 * later as a CI failure in the spec that runs after it, with the leaked page's
 * trace attached to the wrong test's artefact. A convention that has to be
 * remembered in every new file is a convention that will be missed again, so it
 * is checked here instead.
 */
function checkContextCleanup(dirs) {
  const OPENS = /\b(?:newPlayer|addBrowserObserver|hostCreatesAndStartsParty)\s*\(/;
  let checked = 0;
  for (const dir of dirs) {
    const full = join(ROOT, dir);
    for (const file of readdirSync(full).filter((f) => f.endsWith(".spec.ts"))) {
      const src = stripNonCode(readFileSync(join(full, file), "utf8"));
      if (!OPENS.test(src)) continue;
      checked += 1;
      // Must be *wired into* afterEach — importing the symbol is not enough, and
      // an `includes()` check would be satisfied by the import line alone.
      if (!/afterEach\s*\(\s*(?:closeOpenContexts|[^)]*\bcloseOpenContexts\b)/.test(src)) {
        failures.push(
          `${dir}/${file} opens a browser context but never wires closeOpenContexts into afterEach — ` +
            `add \`test.afterEach(closeOpenContexts)\` or the context leaks into every later test.`
        );
      }
    }
  }
  return checked;
}

const cleanupChecked = checkContextCleanup(["tests/e2e/flows", "tests/e2e/journeys"]);

/**
 * Resolve a markdown heading to the fragment GitHub will generate for it.
 *
 * Mirrors `github-slugger`: lowercase, drop everything that is not a letter,
 * digit, space, combining mark or hyphen — which removes backticks, brackets,
 * punctuation, em-dashes and emoji — then turn each remaining space into a
 * hyphen. Spaces are replaced one for one rather than collapsed, and nothing is
 * trimmed afterwards, because both details are load-bearing: `## 🗿 State Model`
 * really does resolve to `#-state-model`, and `## Load tests — k6` really does
 * resolve to `#load-tests--k6`. A slugger that tidies those up reports working
 * links as broken, which is worse than not checking at all.
 */
function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{Zs}\p{M}-]/gu, "")
    .replace(/\p{Zs}/gu, "-");
}

/** Every fragment a document offers, with GitHub's `-1` suffix for repeats. */
function anchorsOf(src) {
  const seen = new Map();
  const out = new Set();
  for (const m of src.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) {
    const base = slugify(m[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n === 0 ? base : `${base}-${n}`);
  }
  return out;
}

/**
 * Every relative link between these documents must resolve — file and fragment.
 *
 * This is the one check here that verifies a *claim* rather than a count, and it
 * exists because of what it caught on the day it was written: TEST_STRATEGY.md pointed at
 * `#flow-tests-32-tests-across-22-files` while the heading had long since become
 * `35 tests across 23 files`, in the sentence that says "`npm run check:docs`
 * keeps the advertised counts honest". The counts were honest; the cross-
 * reference to them was a 404.
 *
 * It is deliberately generic. Unlike the counters above it re-implements nothing
 * that it verifies — it follows a link and asks whether the target exists — so
 * it cannot certify a shared error the way the test counter once did. External
 * URLs are left alone: reaching them needs a network the unit job does not have,
 * and a doc guard that fails when github.io is slow is a guard people disable.
 */
function checkInternalLinks(docs) {
  const anchors = new Map(docs.map(([name, src]) => [name, anchorsOf(src)]));
  let checked = 0;
  for (const [name, src] of docs) {
    // Fenced and inline code first: these documents quote link syntax when
    // explaining a broken link, and a guard that cannot be quoted is a guard
    // dictating prose. CHANGELOG.md's write-up of this very check quotes the
    // dead anchor that motivated it.
    const prose = src.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
    for (const m of prose.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (/^(?:https?:|mailto:|#!)/.test(target)) continue;
      const [path, fragment] = target.split("#");
      const file = path ? path.replace(/^\.\//, "") : name;
      checked += 1;
      if (path && !existsSync(join(ROOT, file))) {
        failures.push(`${name} links to ${target}, but ${file} does not exist.`);
        continue;
      }
      // Fragments are only checkable in the documents this script has read.
      if (!fragment || !anchors.has(file)) continue;
      if (!anchors.get(file).has(fragment)) {
        failures.push(
          `${name} links to ${target}, but ${file} has no heading with that anchor — ` +
            `the heading was probably renamed without the link following it.`
        );
      }
    }
  }
  return checked;
}

/**
 * README.md claims the axe-core scan covers "every route in the app". Prove it.
 *
 * This guards a sentence, not a number, which is the gap this family of check
 * exists to close: the counters cannot see a claim, and this particular claim
 * breaks in silence. Adding a route to `App.tsx` leaves every existing test
 * green — nothing fails, the scan simply stops being exhaustive while the README
 * goes on saying it is. The failure would only ever be found by re-reading the
 * sentence and counting by hand, which is the practice this whole script
 * replaces.
 *
 * The mapping is by convention: `expectNoViolations(page, label)` labels a scan
 * with its route, dynamic segments dropped (`/lobby/:code` is scanned as
 * `/lobby`) and the catch-all route labelled `/404`.
 */
function checkA11yRouteCoverage() {
  const app = readFileSync(join(ROOT, "src/App.tsx"), "utf8");
  const routes = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) =>
    m[1] === "*" ? "/404" : m[1].replace(/\/:[^/]+/g, "") || "/"
  );
  if (routes.length === 0) {
    failures.push("src/App.tsx declares no <Route path=…> — the a11y route check cannot run.");
    return { routes: 0, scanned: 0 };
  }

  const dir = join(ROOT, "tests/e2e/flows");
  const scanned = new Set();
  for (const file of readdirSync(dir).filter((f) => f.startsWith("a11y-") && f.endsWith(".spec.ts"))) {
    const src = readFileSync(join(dir, file), "utf8");
    for (const m of src.matchAll(/expectNoViolations\s*\([^,]+,\s*"([^"]+)"/g)) scanned.add(m[1]);
  }

  const missed = [...new Set(routes)].filter((r) => !scanned.has(r));
  if (missed.length > 0) {
    failures.push(
      `README.md claims the axe-core scan covers every route, but ${missed.join(", ")} ` +
        `${missed.length === 1 ? "is" : "are"} declared in src/App.tsx and never scanned — ` +
        `add it to tests/e2e/flows/a11y-*.spec.ts or stop claiming every route.`
    );
  }
  return { routes: new Set(routes).size, scanned: scanned.size };
}

const a11y = checkA11yRouteCoverage();

// ─── Family 6: traceability ──────────────────────────────────────────────────

/** `J1`/`J2`/`J3` as TRACEABILITY.md uses them, resolved to real files. */
const JOURNEY_SHORTHAND = {
  J1: "host-creates-party.spec.ts",
  J2: "guest-full-journey.spec.ts",
  J3: "full-party-simulation.spec.ts",
};

/** Every test file that can carry an `@covers` header, as basename → path. */
function testFiles() {
  const out = new Map();
  for (const dir of ["tests/unit", "tests/e2e/flows", "tests/e2e/journeys", "tests/load"]) {
    const full = join(ROOT, dir);
    if (!existsSync(full)) continue;
    for (const f of readdirSync(full)) {
      if (/\.(spec|test)\.ts$/.test(f) || (dir === "tests/load" && f.endsWith(".js"))) {
        out.set(f, join(dir, f));
      }
    }
  }
  return out;
}

/**
 * Read the `@covers` / `@regression` declarations out of a test file's header.
 *
 * Deliberately only the first 5 lines: the declaration is a contract with this
 * guard, not a note, and letting it hide 200 lines down would make "the file
 * does not declare it" indistinguishable from "nobody could find it".
 */
function declarationsIn(path) {
  const head = readFileSync(join(ROOT, path), "utf8").split("\n").slice(0, 5).join("\n");
  const covers = /^\/\/ @covers (.+)$/m.exec(head);
  const regression = /^\/\/ @regression (.+)$/m.exec(head);
  const parseIds = (s) =>
    s && !/^none\b/.test(s.trim())
      ? s.split(",").map((x) => x.trim()).filter((x) => /^[A-Z]{2}-\d{3}$/.test(x))
      : [];
  return {
    declared: !!covers,
    covers: parseIds(covers?.[1] ?? ""),
    regression: (regression?.[1] ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter((x) => /^BUG-\d{3}$/.test(x)),
  };
}

/** Requirement IDs defined in SPECS.md's numbered requirement tables. */
function requirementsInSpecs(specs) {
  const ids = new Set();
  // Requirement rows are `| XX-000 | <text> | <risk> |` — three columns. The
  // traceability matrix that used to live here had six, and this shape is what
  // told them apart before it moved out to TRACEABILITY.md.
  for (const m of specs.matchAll(/^\| ([A-Z]{2}-\d{3}) \| [^|]+ \| [^|]+ \|$/gm)) {
    ids.add(m[1]);
  }
  return ids;
}

/**
 * Reconcile TRACEABILITY.md against the test files, in both directions.
 *
 * This exists because the chain used to be prose in two documents and checked
 * by nobody, and had already drifted twice: TEST_STRATEGY.md called signed-URL expiry
 * out of scope for three weeks after four tests began asserting it, and the CI
 * config advertised counts no longer on disk. Both were found by reading the
 * files mechanically, neither by review.
 *
 * The asymmetry is deliberate. A row citing a test that does not claim the
 * requirement is a *false* traceability claim and always fails. A test
 * declaring a requirement no row records is an *unrecorded* one — also a
 * failure, because the matrix is supposed to be complete, and a reader who
 * trusts it would miss coverage that exists.
 */
function checkTraceability(trace, specs) {
  const files = testFiles();
  const specIds = requirementsInSpecs(specs);

  // Every test file must declare something, even if that something is "none".
  const declarations = new Map();
  for (const [base, path] of files) {
    const d = declarationsIn(path);
    if (!d.declared) {
      failures.push(
        `${path} has no \`// @covers\` header. Every test file declares what it ` +
          `verifies (use \`// @covers none — <why>\` when it verifies no requirement).`
      );
      continue;
    }
    declarations.set(base, { ...d, path });
    for (const id of d.covers) {
      if (!specIds.has(id)) {
        failures.push(`${path} declares @covers ${id}, which is not a requirement in SPECS.md`);
      }
    }
  }

  // Parse the matrix:
  // `| REQ | requirement | status | layer | verified by | gate | bugs |`. The
  // requirement gist is skipped: SPECS.md holds the normative wording, and this
  // column only restates it so a row can be read without opening that file.
  const rows = new Map();
  for (const m of trace.matchAll(
    /^\| ([A-Z]{2}-\d{3}) \| [^|]+ \| ([^|]+) \| ([^|]+) \| (.+?) \| [^|]* \| [^|]* \|$/gm
  )) {
    const [, id, status, , verifiedBy] = m;
    const cited = new Set();
    for (const f of verifiedBy.matchAll(/`([\w.-]+\.(?:spec|test)\.ts|[\w.-]+\.js)`/g)) cited.add(f[1]);
    for (const j of verifiedBy.matchAll(/\bJ([123])\b/g)) cited.add(JOURNEY_SHORTHAND[`J${j[1]}`]);
    rows.set(id, { cited, implicit: status.includes("🟡") });
  }

  // Direction 1 — every requirement in SPECS.md has a row here.
  for (const id of specIds) {
    if (!rows.has(id)) {
      failures.push(`${id} is a requirement in SPECS.md with no row in TRACEABILITY.md`);
    }
  }

  // Direction 2 — every cited file exists and claims the requirement.
  for (const [id, { cited, implicit }] of rows) {
    if (implicit) continue; // 🟡 rows cite infrastructure, not files, by definition
    if (cited.size === 0) {
      failures.push(`TRACEABILITY.md ${id} is marked covered but cites no test file`);
      continue;
    }
    for (const base of cited) {
      if (!files.has(base)) {
        failures.push(`TRACEABILITY.md ${id} cites \`${base}\`, which is not on disk`);
        continue;
      }
      const d = declarations.get(base);
      if (d && !d.covers.includes(id)) {
        failures.push(
          `TRACEABILITY.md ${id} cites \`${base}\`, but that file does not declare @covers ${id}`
        );
      }
    }
  }

  // Direction 3 — every requirement a test claims is recorded in the matrix.
  for (const [base, d] of declarations) {
    for (const id of d.covers) {
      if (!specIds.has(id)) continue; // already reported above
      const row = rows.get(id);
      if (row && !row.cited.has(base)) {
        failures.push(
          `${d.path} declares @covers ${id}, but TRACEABILITY.md's ${id} row does not cite it`
        );
      }
    }
  }

  // Direction 4 — every fixed bug has a declared regression guard somewhere.
  const guarded = new Set();
  for (const d of declarations.values()) for (const b of d.regression) guarded.add(b);

  return { rows: rows.size, files: declarations.size, guarded };
}

/**
 * Family 7 — the CI config describes the suite in its own comments, and nothing
 * used to check it. `ci.yml` said "165 unit tests" and "30 E2E tests" while the
 * repo's whole pitch is that its documentation cannot drift; the guard simply
 * could not see the file. Any `<n> unit tests` / `<n> E2E tests` phrase in a
 * workflow must now match the count on disk.
 */
function checkWorkflowCounts(unitBlocks, e2eBlocks) {
  const dir = join(ROOT, ".github/workflows");
  if (!existsSync(dir)) return 0;
  let checked = 0;
  for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    const src = readFileSync(join(dir, file), "utf8");
    for (const [, n] of src.matchAll(/(\d+) unit tests/g)) {
      checked++;
      if (Number(n) !== unitBlocks) {
        failures.push(
          `.github/workflows/${file} says "${n} unit tests" — ${unitBlocks} are on disk`
        );
      }
    }
    for (const [, n] of src.matchAll(/(\d+) E2E tests/g)) {
      checked++;
      if (Number(n) !== e2eBlocks) {
        failures.push(`.github/workflows/${file} says "${n} E2E tests" — ${e2eBlocks} are on disk`);
      }
    }
  }
  return checked;
}

const readme = readFileSync(join(ROOT, "README.md"), "utf8");
const testing = readFileSync(join(ROOT, "TEST_STRATEGY.md"), "utf8");
const specs = readFileSync(join(ROOT, "SPECS.md"), "utf8");
const results = readFileSync(join(ROOT, "TEST_RESULTS.md"), "utf8");

const trace = readFileSync(join(ROOT, "TRACEABILITY.md"), "utf8");

const bugs = bugsInTraceability(trace);

/**
 * Two documents are optional: `CHANGELOG.md` and `ROADMAP.md`, the development
 * log and the open-work list, are kept with the working repository this one is
 * published from, and are not part of the published tree.
 *
 * The guard has to pass in both trees, so it reads them where they exist and
 * skips them where they do not — it used to `readFileSync` them unconditionally,
 * which would have thrown `ENOENT` in the copy before checking anything at all.
 * Only the *reading* is optional. A link pointing **into** a missing file still
 * fails, which is the half that matters: a published document must not send a
 * reader to something the repository does not ship.
 */
const OPTIONAL_DOCS = ["ROADMAP.md", "CHANGELOG.md"];

const linkedDocs = [
  ["README.md", readme],
  ["TEST_STRATEGY.md", testing],
  ["SPECS.md", specs],
  ["TEST_RESULTS.md", results],
  ["TRACEABILITY.md", trace],
  ["ARCHITECTURE.md", readFileSync(join(ROOT, "ARCHITECTURE.md"), "utf8")],
];
const absentDocs = [];
for (const name of OPTIONAL_DOCS) {
  const path = join(ROOT, name);
  if (existsSync(path)) linkedDocs.push([name, readFileSync(path, "utf8")]);
  else absentDocs.push(name);
}

const linksChecked = checkInternalLinks(linkedDocs);

/**
 * Family 8 — no file anywhere names a document this tree does not have.
 *
 * `checkInternalLinks` only reads the documents listed above, so it sees a
 * markdown link and nothing else. Preparing this tree to be published without
 * its development log, a sweep of those documents looked complete and was not:
 * a Stryker comment, the pull-request template, a workflow comment and an E2E
 * spec header all still sent a reader to `ROADMAP.md` or `CHANGELOG.md`. Four
 * dead references in files the guard had no reason to open, found by grep after
 * the guard had already said the tree was clean.
 *
 * So the claim is widened to what it was always meant to be: *nothing in this
 * repository points at a document that is not in it.* Any `SHOUTING_CASE.md`
 * mentioned in source, config, workflows or docs must exist on disk.
 *
 * Two exemptions, both with reasons. This script names the optional documents
 * as data — exempting it is not a hole, since its own references are the
 * mechanism being tested. And the development log records history, including
 * files that were renamed or deleted along the way; it is the one place where
 * naming a file that no longer exists is correct, and it does not travel.
 *
 * A section reference is a document reference too. `ROADMAP §2.1`, `CHANGELOG
 * §3.4`, `ROADMAP 2.11` or a bare `§3.6` names no file, so the pattern above
 * never saw one — and about twenty of them sat in test headers, source comments,
 * a workflow and two documents, each pointing a reader of the published copy at
 * a page it does not have. Numbered sections exist only in the roadmap, so a
 * bare `§` counts as naming it.
 *
 * One exemption, by name: the five migrations below are applied, and the
 * migration history records their text. Their comments cite roadmap sections
 * and are kept as they were written, on the owner's call — a file the database
 * has already run is not reworded to satisfy a doc guard. A *new* migration is
 * scanned like any other file.
 */
const REFERENCE_SCAN_SKIP = new Set([
  "scripts/check-doc-counts.mjs",
  "CHANGELOG.md",
  "ROADMAP.md",
  "package-lock.json",
]);
const REFERENCE_SCAN_DIRS_SKIP = new Set([
  ".git",
  "node_modules",
  "coverage",
  "dist",
  "site",
  "playwright-report",
  "reports",
  "test-results",
]);
const REFERENCE_SCAN_EXT = /\.(md|mjs|js|ts|tsx|ya?ml|json|sql)$/;
const SECTION_REF = /\b(ROADMAP|CHANGELOG)(?:\.md)?\s*§?\s*\d+\.\d+|(?<![\w§])§\s*\d+(?:\.\d+)?/g;
const SECTION_REF_EXEMPT = new Set([
  "supabase/migrations/20260827124027_add_max_votes_party_setting.sql",
  "supabase/migrations/20260901172918_expose_max_votes_in_get_party_by_code.sql",
  "supabase/migrations/20260907163000_expose_max_votes_in_create_party_with_host.sql",
  "supabase/migrations/20260907170000_drop_situations_emoji.sql",
  "supabase/migrations/20260910005500_enforce_vote_cap.sql",
]);

function checkDocReferences(dir = "") {
  let checked = 0;
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (REFERENCE_SCAN_DIRS_SKIP.has(entry.name)) continue;
      checked += checkDocReferences(rel);
      continue;
    }
    if (REFERENCE_SCAN_SKIP.has(rel) || !REFERENCE_SCAN_EXT.test(entry.name)) continue;

    const src = readFileSync(join(ROOT, rel), "utf8");
    const named = new Set();
    for (const [, name] of src.matchAll(/\b([A-Z][A-Z0-9_]*\.md)\b/g)) named.add(name);
    for (const name of named) {
      checked += 1;
      if (!existsSync(join(ROOT, name))) {
        failures.push(
          `${rel} names ${name}, which is not in this tree — ` +
            `a reader following it finds nothing.`
        );
      }
    }

    if (SECTION_REF_EXEMPT.has(rel)) continue;
    const lines = src.split("\n");
    lines.forEach((text, i) => {
      for (const m of text.matchAll(SECTION_REF)) {
        checked += 1;
        const doc = `${m[1] ?? "ROADMAP"}.md`;
        if (!existsSync(join(ROOT, doc))) {
          failures.push(
            `${rel}:${i + 1} cites "${m[0].trim()}", a section of ${doc}, which is not in ` +
              `this tree — state the reason instead of pointing at it.`
          );
        }
      }
    });
  }
  return checked;
}

const docReferences = checkDocReferences();

const traceability = checkTraceability(trace, specs);
const workflowClaims = checkWorkflowCounts(unit.blocks, flows.blocks + journeys.blocks);

// Every bug in the inventory must have a test declaring itself its guard. This
// is the check that would have caught a fix shipped with nothing standing
// behind it — and it is why the `@regression` half of the header exists.
for (const id of bugs) {
  if (!traceability.guarded.has(id)) {
    failures.push(
      `${id} is in TRACEABILITY.md's inventory but no test file declares \`// @regression ${id}\``
    );
  }
}


/** Assert a doc contains an exact substring; collect a failure otherwise. */
function expectContains(docName, doc, needle, why) {
  if (!doc.includes(needle)) {
    failures.push(`${docName} is missing "${needle}" — ${why}`);
  }
}

// README.md — pyramid bullet list
expectContains("README.md", readme, `${unit.blocks} tests`, "unit count drifted");
expectContains(
  "README.md",
  readme,
  `${flows.blocks} tests across ${flows.files} files`,
  "flow count/file count drifted"
);

// TEST_STRATEGY.md — headings and pyramid diagram
expectContains("TEST_STRATEGY.md", testing, `Unit Tests  (${unit.blocks} tests)`, "pyramid unit count drifted");
// The flow figure appears twice in TEST_STRATEGY.md — the pyramid diagram and the section
// heading — and only the heading used to be guarded. The diagram was found stale
// by hand during the 2026-08-20 review, which is exactly the failure mode this
// script exists to make impossible.
expectContains(
  "TEST_STRATEGY.md",
  testing,
  `E2E Flows   (${flows.blocks} tests)`,
  "pyramid flow count drifted"
);
expectContains(
  "TEST_STRATEGY.md",
  testing,
  `Flow Tests (${flows.blocks} tests across ${flows.files} files)`,
  "flow heading count drifted"
);

// TEST_STRATEGY.md — the CI tier table. The smoke tier is what gates every PR, so a
// drifted number here misrepresents what a green PR check actually proved.
expectContains(
  "TEST_STRATEGY.md",
  testing,
  `the **\`@smoke\`** E2E tier — ${smoke.blocks} tests across ${smoke.files} files`,
  "smoke tier count drifted"
);
expectContains(
  "TEST_STRATEGY.md",
  testing,
  `the **full** E2E suite — ${flows.blocks + journeys.blocks} tests across ${flows.files + journeys.files} files`,
  "full E2E count drifted"
);

// README.md — the bug inventory. Two separate failure modes, so two checks.
if (bugs.length > 0) {
  const word = NUMBER_WORDS[bugs.length] ?? String(bugs.length);

  // (a) The headline count, in both places the README states it.
  expectContains(
    "README.md",
    readme,
    `**${word} bugs found, all resolved**`,
    "README bug count drifted from TRACEABILITY.md"
  );
  expectContains(
    "README.md",
    readme,
    `${word} bugs came out of it`,
    "README bug count drifted from TRACEABILITY.md"
  );

  // (b) Each bug individually. The count matching while a bug is missing is a
  //     real state — it is what happens when one is added and another dropped.
  //
  //     Matches the bolded id anywhere in the file rather than a `- ` bullet.
  //     The guarantee is that no bug in the inventory silently disappears from the
  //     README; requiring one particular markdown construct was the check
  //     dictating layout, and it failed the day the list became a table. A
  //     guard that blocks a presentation change it has no opinion about trains
  //     people to edit the guard, which is the opposite of what it is for.
  for (const id of bugs) {
    expectContains(
      "README.md",
      readme,
      `**${id}**`,
      `${id} is in TRACEABILITY.md but is not mentioned in README.md`
    );
  }

  // (c) The write-ups. TEST_RESULTS.md owns them since the 2026-09-02 split, and
  //     a bug that reaches the inventory without its account of what was
  //     hypothesised, what assertion confirmed it and what the fix was is the
  //     inventory growing a row rather than the suite proving anything.
  //
  //     No bug is exempt. BUG-003 and BUG-010 are absent from the *table* of
  //     bugs tests caught, deliberately and with the reason stated there —
  //     neither was found by a test. That is a claim about the table, not a
  //     licence to have no write-up, and BUG-003 spent a while with neither
  //     while the README pointed its first-time reader straight at one.
  for (const id of bugs) {
    expectContains(
      "TEST_RESULTS.md",
      results,
      `${id} —`,
      `${id} is in TRACEABILITY.md but has no write-up in TEST_RESULTS.md`
    );
  }
}

console.log(
  `Counts on disk → unit: ${unit.blocks} (${unit.files} files), ` +
    `flows: ${flows.blocks} (${flows.files} files), journeys: ${journeys.blocks} (${journeys.files} files), ` +
    `@smoke: ${smoke.blocks} (${smoke.files} files), ` +
    `bugs in TRACEABILITY.md: ${bugs.length} (${bugs.join(", ")})`
);
console.log(`Context cleanup verified in ${cleanupChecked} specs that open browser contexts`);
console.log(
  `Cross-references: ${linksChecked} relative links resolved · ` +
    `a11y scan covers ${a11y.routes} routes declared in src/App.tsx · ` +
    `${docReferences} document names and section references across the tree all resolve` +
    (absentDocs.length ? ` · not in this tree: ${absentDocs.join(", ")}` : "")
);
console.log(
  `Traceability: ${traceability.rows} requirement rows reconciled against ` +
    `${traceability.files} declaring test files, both directions · ` +
    `${traceability.guarded.size} bugs have a declared regression guard · ` +
    `${workflowClaims} CI-comment claims checked`
);

if (failures.length > 0) {
  console.error("\n✗ Doc-count guard failed:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  console.error("\nUpdate the docs (or the tests) so the advertised numbers match reality.\n");
  process.exit(1);
}

console.log(
  "✓ Doc counts, the bug inventory, every cross-reference, the a11y route claim,\n" +
    "  the traceability chain and the CI config's own prose all hold up"
);
