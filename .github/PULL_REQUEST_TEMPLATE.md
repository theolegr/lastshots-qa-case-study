## What this changes

<!-- One or two sentences. The *why* is more useful than the *what* — the diff
     already says what. -->

## Evidence

This repository's subject is testing discipline, so a PR carries its evidence
rather than asserting it. Delete rows that genuinely do not apply; do not delete
rows that apply and were skipped — say they were skipped and why.

- [ ] **Tier run locally:** <!-- `npm test` / `npx playwright test --grep @smoke` / full suite / none -->
- [ ] **A regression test was seen to fail before the fix.** Guiding Rule 4
      (`TEST_STRATEGY.md`): a test that has never been red against the broken code proves
      nothing. Paste the failing output, or say why no test applies.
- [ ] **New spec opening a browser context wires `closeOpenContexts`.**
      `check:docs` enforces this — a leaked context keeps a session, a Realtime
      subscription and a countdown alive for the rest of the worker.
- [ ] **New writes to `parties` go through `updateParty`** (`tests/e2e/helpers/db.ts`).
      A bare UPDATE matching zero rows returns `error: null`, so a fixture can
      report success for a party it never moved.
- [ ] **Docs updated where a claim changed** — `SPECS.md` for requirements,
      `TRACEABILITY.md` for the requirement → test chain, `TEST_STRATEGY.md` for
      coverage, `TEST_RESULTS.md` for what a run reported, `ARCHITECTURE.md` for
      implementation.

## Anything knowingly left open

<!-- Known gaps, deferred decisions, follow-ups. A PR that says "nothing" and is
     wrong costs more than one that names its loose ends. -->

---

<sub>CI: every PR runs lint, typecheck, the doc-count guard and the unit suite.
PRs targeting `main` additionally run the `@smoke` E2E tier; the full suite runs
on push to `main`.</sub>
