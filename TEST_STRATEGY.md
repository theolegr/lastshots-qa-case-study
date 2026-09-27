# Test Strategy

How the requirements in [`SPECS.md`](./SPECS.md) are verified: the approach and
its rationale, the scope, the test inventory, the harness, the CI tiers, and the
gaps that remain. What the runs reported is in
[`TEST_RESULTS.md`](./TEST_RESULTS.md); which test proves which requirement is in
[`TRACEABILITY.md`](./TRACEABILITY.md).

---

## Risk Areas

The approach is risk-based. The riskiest parts of the app are the three things
it leans on — anonymous sign-in, Realtime updates between players, and the
database rules that keep one party's data away from another — and each risk
below has a named test.

| Area | Risk | Mitigation |
|------|------|------------|
| Vote counting logic | Off-by-one, tie-break ambiguity | Unit tests on pure functions |
| State machine transitions | Invalid phase jumps, wrong phase derived | Unit tests with exhaustive state table |
| Session persistence | User loses in-progress state after reload | Journey 2 (reload checkpoints) |
| Real-time sync | Phase change not propagated to all clients | Journey 3 (3 concurrent sessions) |
| Vote cap enforcement | Cap bypassable by double-tap race, or by a client skipping the UI | Flow + unit test for the UI; `vote-cap-server-side` for the `enforce_vote_quota` trigger, including under simultaneous inserts |
| RLS tenant isolation | Participants read/write another party's data | `rls-isolation` (explicit cross-party denial); all E2E runs under real RLS |
| Write idempotency | Duplicate votes counted twice under retries | `concurrent-voting` k6 storm + `UNIQUE(photo_id, voter_id)`; `deduplicateVotes` unit test |
| Accessibility | Unlabeled controls, contrast, broken landmarks | `a11y-smoke` + `a11y-phases` (axe-core, every route in `src/App.tsx`) |

---

## Test Architecture

```
  Functional pyramid                          Non-functional
         ┌───────────────────────────┐       ┌───────────────────────────┐
         │   E2E Journeys (3 tests)  │       │   Load  (k6, 2 scenarios) │  ← p95 latency + error-rate
         ├───────────────────────────┤       │   join burst + vote storm │     thresholds, real Supabase
         │   E2E Flows   (35 tests)  │       └───────────────────────────┘
         ├───────────────────────────┤
         │   Unit Tests  (174 tests) │  ← pure functions, no I/O, sub-second total
         └───────────────────────────┘
```

**Unit tests** cover ten pure-logic modules with zero Supabase calls. Four of those modules exist because the code they came from could not be imported by a unit test — see [*Extracting logic to make it testable*](#extracting-logic-to-make-it-testable).

**Flow tests** isolate one concern each — auth, a DB rule, a page's rendering, a security boundary. Each seeds the database to the exact state it needs via `party.fixture.ts` rather than driving the UI, then navigates straight to the page under test.

**Journey tests** walk complete user paths, one angle each: J1 smoke, J2 resilience, J3 concurrency. Flows cannot see failures that only emerge across phase transitions or across browser contexts; journeys cover that and nothing else. BUG-001 stayed hidden until J2 added a second browser context.

**Load tests** sit beside the pyramid rather than on top: they assert latency and error rate under concurrency, which the functional tests deliberately ignore.

### Tooling

| Choice | Why |
|---|---|
| **Playwright**, not Cypress | Several independent browser sessions in one test (J3 runs three), fake-camera flags, iPhone emulation |
| **Vitest** for unit tests | Shares the app's Vite config; the whole tier runs in under a second |
| **A real Supabase backend, not a mock** | A mock would skip the security rules, the sign-in edge cases and Realtime — the failures that matter most |
| **No `service_role` key** | Tests write data as an ordinary signed-in player, so every write is checked by the same rules as production |
| **`retries: 0`** | An unstable test is diagnosed, never retried. Tests wait for a visible signal, not for a fixed time |
| **Cleanup in `afterEach`** | A browser left open after a failure would disturb every test after it |
| **Server-side debug timers, not a mocked clock** | Moving a deadline on the server fires the real Realtime event and the real redirect |
| **One test at a time (`workers: 1`)** | Tests react to live updates on the same backend, so running them in parallel would make them collide. Cost: ~4.5 min for the flow tier |
| **A guard on the documents** | `npm run check:docs` fails when a test count, the bug inventory, a link or the traceability matrix stops matching the code |

---

## Coverage

### In Scope

- Party creation and join flows (host and guest paths), including negative paths
- Capture phase: photo counter, shot cap, per-situation submission
- Voting phase: vote counter, self-vote guard, vote cap, deduplication
- Results phase: podium ranking, tie-break by earliest capture, situation winners
- Phase transitions: waiting → playing → voting → results
- Session persistence: auth and counters survive hard reload
- Real-time sync: all clients receive phase transitions simultaneously
- Host-only controls and settings; cross-client settings propagation
- Tenant isolation under RLS: a participant of one party cannot read or write another's rows
- Non-functional: join-burst latency and error rate under concurrency (k6)
- Accessibility: no serious/critical axe-core violations on every route in the app
- Web Vitals on Home and Join, recorded into the committed metrics history rather than gated

### Out of Scope

Everything this suite deliberately does not test, and why, is in one table:
[*Deliberate boundaries*](#deliberate-boundaries).

The requirement-by-requirement coverage matrix is [`TRACEABILITY.md`](./TRACEABILITY.md), reconciled against the tests on disk by `npm run check:docs`.

---

## Test Cases

### Unit Tests (174 tests across 10 modules)

| Module | Tests | What it covers |
|--------|-------|----------------|
| `stateMachine` | 36 | `getPartyPhase` for all 4 states; valid/invalid transitions; action gating per phase |
| `partyRules` | 28 | `validatePartyInput`; `validateJoinInput` (name 1–50, code `^\d{6}$`); `isValidPartyCode` |
| `dbContracts` | 26 | The boundaries a generated row type cannot cover: the `status` CHECK constraint, the `create_party_with_host` jsonb payload, and untyped Realtime payloads |
| `resultsRules` | 20 | Podium ranking and per-situation winners: ordering, tie-break, zero votes, fewer than 3 photos, orphaned author, votes for deleted photos |
| `submissionRules` | 16 | 15 MB blob limit; shot cap; per-situation completion guard |
| `voteRules` | 13 | Self-vote guard; remaining votes; deduplication; score sorting; tie-break comparator |
| `retention` | 9 | MO-001's 72h window and its exclusive boundary — in `supabase/functions/_shared/`, the file the edge function itself imports |
| `participantRules` | 8 | `mergeParticipant` — idempotent roster merge by id (BUG-005) |
| `storageRules` | 7 | Signed-URL TTL policy; photo object-key shape, whose segment order the storage RLS policies depend on |
| `utils` | 6 | `cn` class merging; re-exports are the same bindings, not copies |

**Coverage: 100% of `src/lib`, enforced in CI.** The scope is the point: everything else is React components covered by Playwright, which Vitest cannot observe, so a repo-wide figure would be larger and mean less. The claim is narrow and checkable — *the extracted business rules are fully covered by fast tests*.

### Flow Tests (35 tests across 23 files)

Ordered by app phase: auth → join → lobby → capture → vote → results, then cross-cutting.

| File | What it isolates |
|------|-----------------|
| `auth-flow` (×2) | The anonymous user id survives a hard reload, and a cold load provisions exactly one identity (BUG-009, IA-002) |
| `auth-signin-failure` | A sign-in refused with a real `429` shows an error screen with a working retry (BUG-010, IA-007) |
| `negative-join-paths` (×3) | Code-format filter; non-existent code wording (BUG-002); late-phase party blocked |
| `qr-scan-flow` (×2) | QR scanner dialog opens; dismiss does not mutate the code input |
| `party-settings` | Host picks 7 situations → CaptureMode renders exactly 7 cards (BUG-001) |
| `settings-immutable` (×2) | Once the party starts, no UI path back to settings, **and** the database refuses the write (PM-004) |
| `countdown-timer-visible` (×2) | The countdown renders in CaptureMode and Vote (NT-002) |
| `locked-phase-transition` | A player waiting on `/vote/:code` moves to voting when the deadline passes, page untouched (BUG-007, PM-008) |
| `rpc-column-contract` | `get_party_by_code` returns every column of `parties`, read from the table at runtime |
| `vote-cap` | The host's quota (seeded at 7, not the default 5) blocks further votes and survives reload |
| `vote-cap-server-side` (×2) | The same quota enforced by the database, including under eight simultaneous inserts (VT-002) |
| `podium-correctness` (×2) | Ranking by vote count; tie broken by earliest `captured_at` |
| `results-display` | The results page renders the right photo count, player count and closing message |
| `results-export` | Save and Share controls are present once results exist (RS-005) |
| `unresolvable-party` | An unresolvable code leaves a usable screen on `/capture`, `/vote` and `/results` (BUG-008, MO-005) |
| `rls-isolation` | A host of party A is denied reads and writes on party B's rows (IA-004, MB-003, MO-002) |
| `storage-privacy` (×4) | A photo is unreachable by direct URL; a valid signature serves it; expired and forged signatures are refused (MO-003, MO-004) |
| `situation-pool-lockdown` | The anon key alone cannot read or write `situation_pool` |
| `a11y-smoke` | Zero serious/critical axe-core violations on the four routes needing no fixture |
| `a11y-phases` | The same scan on lobby, capture, vote and results |
| `web-vitals` | LCP, FCP and navigation timing on Home and Join, recorded rather than gated |
| `edge-function-deployment` (×2) | Every function in `supabase/functions/` answers on this project, plus a control probe (BUG-003, MO-001) |
| `timer-toast-staleness` | An update touching only `voting_ends_at` raises no timer notification (BUG-004, NT-001) |

### Journey Tests (3 tests)

**J1 — Smoke: host creates a party.** Create → lobby; assert the 6-digit code, the host in the participant list, the Start button, and the host-only settings dialog.

**J2 — Resilience: guest state survives reloads, and settings propagate.** Host picks 7 situations and starts → guest sees 7 cards → guest takes 2 photos, reloads, counter still 2/5 → host ends capture, guest is redirected via Realtime → guest casts 2 votes, reloads, counter still 2/5 → guest lands on results.

**J3 — Concurrency: real-time sync across 3 simultaneous sessions.** Host, Alice and Bob; each phase transition routes all three via Realtime; each shoots and votes; finally `podium(host) === podium(alice) === podium(bob)`.

### Load Tests (k6, 2 scenarios)

Both hit real Supabase and run after the E2E suite on every push to `main`, never beside it.

| Scenario | File | Models | Asserts |
|----------|------|--------|---------|
| **Join burst** | `tests/load/join-flow.js` | A party link shared in a group chat — 20 VUs loading the same lobby at once | `p(95) < 2s`; error rate `< 1%` |
| **Vote retry storm** | `tests/load/concurrent-voting.js` | 150 attempts (30 VUs × 5) to cast the **same** vote | Exactly one insert wins (`201`), every duplicate is refused (`409`), no `5xx`, exactly 1 row persisted |

The measured baselines are in [`TEST_RESULTS.md`](./TEST_RESULTS.md#load-tests--k6).

---

## Mutation Testing

100% coverage says every branch was *executed*, not that a test would **fail** if a branch were wrong. Stryker changes one thing in `src/lib` at a time — an operator, a boundary, a string — and re-runs the unit suite; a surviving mutant is a change to the product no test objects to.

```bash
npm run test:mutation        # ~11s, report at reports/mutation/index.html
```

The scores and the survivors are in [`TEST_RESULTS.md`](./TEST_RESULTS.md#mutation-testing).

### Why there is no CI gate

It runs on every push to `main` with no threshold. A mutation score is a measurement: gating it turns every refactor that shifts the mutant population into a build failure someone has to argue with, and the usual response is to lower the threshold until it stops complaining. Regressions are found by comparing runs instead, which only works if the runs survive — every one appends a row to the metrics history, on its own `metrics` branch. The same argument covers the k6 baselines and the Web Vitals.

---

## Harness

### Playwright configuration

| Setting | Value | Rationale |
|---|---|---|
| Projects | One: `chromium-mobile` (iPhone 15 Pro Max, forced to Chromium) | Mobile-first product; WebKit supports neither the fake-camera flags nor the permissions API |
| `retries` | `0` | Flakiness is diagnosed, not masked |
| `trace` | `retain-on-failure` | `on-first-retry` produces nothing at `retries: 0` |
| `workers` / `fullyParallel` | `1` / `false` | See *Tooling* |
| Camera | `--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream` | Supplies a stream and auto-accepts the permission dialog |
| Timeouts | 120s test (300s for J3), 10s expect, 15s navigation, 10s action | |
| `webServer` | `npm run dev` | Keeps the debug-timer buttons reachable — they are dev-only |

### Layout

```
tests/
├── unit/                              # one spec per pure-logic module, no I/O
├── load/                              # k6, after E2E on every push to main
└── e2e/
    ├── fixtures/party.fixture.ts      # seeds parties into a given DB state
    ├── helpers/                       # capture, voting, party setup, db writes, a11y, sign-in budget
    ├── journeys/                      # 3 multi-step, multi-client lifecycles
    └── flows/                         # 23 files, one concern each
```

### Key patterns

- **Every write to `parties` goes through `updateParty`** (`helpers/db.ts`). A bare `UPDATE` matching zero rows returns `error: null` in supabase-js, so a fixture checking only `error` reports success for a party it never moved. `updateParty` selects the rows back and throws on zero.
- **Flow tests seed through fixtures, never the UI** — except `party-settings`, which deliberately drives the dialog end to end.
- **Multi-client tests** use a separate `browser.newContext()` per player.
- **J3 reloads the host page** if Realtime misses a participant insert — the one tolerated workaround, scoped to the single flaky dependency.

### Locator strategy

- **`getByTestId` is primary.** Every interactive element carries a `data-testid` named `{page-or-component}-{element}-{type}`; the registry is in [`ARCHITECTURE.md`](./ARCHITECTURE.md#test-selectors-data-testid).
- **`getByText` for state assertions** — counters, phase headings, statuses — because the copy *is* the state under assertion.
- **`getByRole` sparingly**, always scoped by a testid first.
- **Raw CSS only as an escape hatch** for third-party widgets: `[data-sonner-toast]`, `#qr-reader`.

---

## Execution

```bash
npm test                 # unit tests (sub-second)
npm run typecheck        # tsc over src/ and tests/
npm run lint             # ESLint
npm run check:docs       # doc guard: advertised counts, cross-references, claims
npm run test:smoke       # the PR tier
npm run test:e2e         # full E2E suite

HEADED=1 npx playwright test --headed   # watch it run
npx playwright show-report              # HTML report
```

### CI tiers

| Trigger | What runs | Cost |
|---------|-----------|------|
| **Every PR, whatever it targets**, and every push to `main` | lint, typecheck, doc-count guard, 174 unit tests | ~40s, no quota |
| **PR targeting `main`** | the **`@smoke`** E2E tier — 23 tests across 15 files | ~1m40s |
| **Push to `main`** | the **full** E2E suite — 38 tests across 26 files, then k6 | ~8m20s + ~2m, **104** + 3 anon sign-ins |
| On demand (`workflow_dispatch`) | the same | — |

What each run on `main` measured is recorded on a separate `metrics` branch,
never on `main`, so every commit on `main` is one that was written by hand and
carries its own CI verdict.

**Anonymous sign-ins are the binding resource, not wall-clock time.** The cap is 200/hour per IP and a push to `main` spends 107, so one fits in an hour. The cheapest way back under the cap is always to seed fewer players or scan fewer pages — the trade this suite refuses. The figure is measured by `tests/e2e/helpers/signin-budget.ts`, after two hand counts were wrong.

**What gates a pull request (`@smoke`).** Every bug's regression test and every
security check, plus one journey (J1) proving the app boots and completes a
real transaction; the rest is chosen for being cheap. The two longer journeys,
J2 and J3, run only after merge, which keeps the pull-request check about four
times faster.

**The one exception.** BUG-006's regression test *is* Journey 3, so it is the
only bug guard that does not run on a pull request. That is accepted on two
conditions: a recurrence would show up on `main` within one push, and a red
`main` is investigated the same day. If that stops being true, J3 moves back
into the pull-request check.

---

## Extracting Logic to Make It Testable

Some business rules — how the podium is ranked, when a photo link expires, when
a party is old enough to delete — used to live in files a unit test cannot load,
because those files open a connection to the database as soon as they are
imported. The usual workaround is to fake the database. Instead, each rule was
moved into its own small file with no database in it, so a unit test can check
it directly in milliseconds. Four of the ten unit-tested modules came from that
(`resultsRules`, `storageRules`, `dbContracts`, `retention`), and moving the
retention rule also exposed a daylight-saving bug in how 72 hours was counted.

---

## Guiding Rules

Eight rules emerged from the work above. They are cited by number from the pull-request template; the bugs behind them are in [`TEST_RESULTS.md`](./TEST_RESULTS.md#bugs-confirmed-by-tests).

1. **Any state set by one user that others must observe needs a multi-context assertion at journey level.** Defaults mask divergence: both clients arrive at the same value through different code paths.

2. **When one error handler covers semantically different causes, assert on the wording each cause produces.** Blocking is easy to verify; diagnostic accuracy is what users rely on.

3. **"Not automatable" is usually a requirement stated too coarsely.** MO-004 ("signed URLs expire after 7 days") looked like it needed time travel. Split into a mechanism (an expired signature is refused — provable in seconds with a short TTL) and a policy (the TTL is 7 days — a constant), both halves are trivial.

4. **A regression test that has never been seen to fail is an assumption, not a guard.** Two of the three guards first written for BUG-004 passed against the broken build.

5. **Static analysis covers a blind spot the suite has by construction.** BUG-004 was a lint warning with the whole suite green. Tests check behaviour someone thought to specify; a linter checks a class of defect nobody has to think of first.

6. **A fixture that does not verify its own writes moves the failure to the wrong layer.** An `UPDATE` matching zero rows returns `error: null`, and the test fails later against a DOM that is correct for the state the party is actually in.

7. **Run the spec that drives the change, not the tier that might contain it.** Three green `@smoke` runs passed while `max_votes` was broken, because the one spec that proved it end to end was not in `@smoke`. A tier is a sample chosen before the change.

8. **`element(s) not found` is a symptom with four causes, and the run already attached the evidence that tells them apart.**

   | What the DOM snapshot shows | Cause |
   |---|---|
   | Another test's party | A leaked browser context |
   | The state the party is *actually* in | A fixture whose write was refused and not verified — rule 6 |
   | **Home**, when the test navigated elsewhere | An identity mismatch between the page and the fixture (BUG-009) |
   | **The auth error screen** | The anon sign-in quota is gone |

   The general form is worth more than the table: **read the artefact before forming the hypothesis.**

---

## Deliberate boundaries

What this suite does not test, on purpose or not yet. A *decision* has a date
and a reason; a *gap* is work not done.

| Not tested | Status | Why |
|---|---|---|
| **The exported results image** (RS-005) | Decision, 2026-09-09 | That the export is *available* is tested. A pixel comparison of a rendered image is the least stable check in browser testing, for a property no requirement states |
| **The full QR decode path** (MB-007) | Decision, 2026-09-09 | Needs the QR library mocked, in a suite built on mocking nothing. Both ends are tested: the scanner dialog, and the 6-digit filter a scanned code must pass |
| **Desktop viewports** | Decision, 2026-08-23 | A party app used on phones. WebKit is excluded too: no fake-camera support |
| **Pinch zoom** | Decision, 2026-09-10 | A real WCAG 1.4.4 finding. Zoom stays disabled by product decision: a camera app held one-handed, where an accidental pinch costs the shot |
| **Web Vitals beyond Home and Join** | Decision, 2026-09-10 | Load time changes what someone does only before they have joined |
| **The production bundle** | Decision, 2026-09-10 | The suite runs the development build — which is what made BUG-009 findable. The security rules under test are identical in both |
| **A player whose session is wiped** | Decision, 2026-09-10 | Clearing browser storage creates a new identity, locked out of the old one's party. Rare within a party's 72 h life, and recovering it is what the security rules forbid by design |
| **Deleting a party under a live session** (MO-005) | Decision, 2026-09-09 | No client can delete a party. What a deletion leaves behind is tested (`unresolvable-party`); the deletion itself is not |
| **`cleanup-old-parties` accepts an unauthenticated call** | Decision, 2026-09-21 | This backend serves the tests, not live users, and the function only deletes what is already past 72 hours. Reopens if the project ever holds real data |
| **PS-005: the ids on a photo are not checked against each other** | Decision, 2026-09-26 | The database checks that each id exists, not that they belong to the same party, and a client can insert a mismatched row. The app always sends matching ids. Closing it means a tighter database rule and a test that watches it refuse |
| **Full accessibility audit, sustained load, push notifications** | Decision | Screen-reader and keyboard-only journeys are a manual discipline; k6 covers bursts, not endurance; the web app sends no push notifications |
| **Retention actually running** | Gap | The deployment probe proves the cleanup function is reachable, not that anything calls it. The daily workflow's run history is the evidence |
| **QR code generation** | Gap | Would need a visual assertion |

A gap closes by leaving this table, with the test that closed it named in [`TRACEABILITY.md`](./TRACEABILITY.md).
