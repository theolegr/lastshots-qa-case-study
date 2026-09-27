# Test Results — LastShots

What the runs reported: the measurements, the reports you can open, and the
defects the suite caught. [`SPECS.md`](./SPECS.md) says what must be true and
[`TEST_STRATEGY.md`](./TEST_STRATEGY.md) how it is checked; this document says
what happened when it was.

---

## Where each report comes from

| Tier | Command | Machine-readable output | Published |
|---|---|---|---|
| Unit + coverage | `npm run test:coverage` | `coverage/coverage-summary.json` | Pages → `/coverage/` |
| E2E (Playwright) | `npm run test:e2e` | `playwright-report/` | Pages → `/playwright/` |
| Mutation (Stryker) | `npm run test:mutation` | `reports/mutation/mutation.json` | Pages → `/mutation/` |
| Load (k6) | `k6 run tests/load/<scenario>.js` | `reports/load/<scenario>.summary.json` | Pages → `/load/` |
| Web Vitals | `npx playwright test tests/e2e/flows/web-vitals.spec.ts` | `reports/vitals/vitals.json` | — (the measurements history only) |

Web Vitals are recorded on Home and Join and never gated: an LCP budget measured
against a dev server and a live backend moves with the network, and
`retries: 0` means every such red costs a person an afternoon. The load suite
runs after the E2E suite on every push to `main`, never beside it.

## Measurements over time

Coverage is the only figure enforced in CI (100% on `src/lib`). The mutation
score, the load figures and the Web Vitals are deliberately not gated — see
[*Why there is no CI gate*](./TEST_STRATEGY.md#why-there-is-no-ci-gate) — and are
watched by comparison instead.

Every run on `main` appends one line to [`metrics.jsonl`](https://github.com/theolegr/lastshots-qa-case-study/blob/metrics/metrics.jsonl) on the
`metrics` branch, kept off `main` so the history of the code holds only
authored commits. The [published site](https://theolegr.github.io/lastshots-qa-case-study/#measurements) renders where each figure stands
now and the range it has held. Latency is ranged over CI runs only, since a
developer machine's figure measures its own network.

---

## Mutation testing

The first run scored **93.09%** — 13 of 188 mutants survived. Addressing them
took it to 99.47%, and the score has held between 99.47% and 99.54% as the code
grew. What the survivors taught:

- **Tests that never read the error message.** Nine survivors were error
  messages that could be blanked with the suite still green, because
  `.toThrow()` with no argument passes on any error. That is the class of defect
  BUG-002 shipped: blocking worked, the diagnosis lied. The same gap reappeared
  in the first message written afterwards — knowing a class of defect exists
  does not prevent it; running mutation testing on new code does.
- **Deadlines nobody pinned.** `now > endsAt` could become `>=` unnoticed. Every
  phase in this product is a timestamp comparison, so the tests now freeze the
  clock and pin the rule: at the deadline you are still in the earlier phase.
- **A regex tested with one example per side.** `"2.5"` accepted and `"twelve"`
  rejected cannot tell an anchored pattern from an unanchored one; `"12abc"` can.
- **One survivor is left alive, on purpose.** It changes the code without
  changing any behaviour a test could observe (an *equivalent mutant*). It is
  explained rather than suppressed: 99.54% with one explained survivor is a more
  honest claim than a 100% that asks the reader to trust the suppression.

---

## Load tests — k6

### Measured baselines — 2026-09-01

| Scenario | Threshold | Measured | Headroom |
|---|---|---|---|
| Join burst — p95 latency | `< 2s` | **249 ms** | ~8× |
| Join burst — error rate | `< 1%` | **0.00%** (0 / 1162) | — |
| Vote storm — inserts accepted | exactly 1 | **1** (`201`) | — |
| Vote storm — duplicates rejected | all others | **149** (`409`) | — |
| Vote storm — server errors | 0 | **0** | — |
| Vote storm — p95 latency | not asserted | **578 ms** (295 ms on `2xx` only) | — |

Join burst: 20 VUs, 1165 requests. Vote storm: 30 VUs × 5 attempts on the same
`(photo_id, voter_id)`; `teardown()` reads the row back and finds exactly one.
The vote storm's `http_req_failed: 93.12%` is the intended result — k6 counts a
`409` as a failure, and 149 of 150 attempts are supposed to be refused.

Measured from a developer machine, so the latencies include its round-trip: a
baseline to compare against from the same origin, not a characterisation of the
backend.

---

## Bugs Confirmed by Tests

**What an ignored red build was costing.** Two of these defects — a duplicated
player in the lobby, and a player stranded on the voting screen — had been in
the product for six and seven months. The suite had been failing intermittently
the whole time, and each red run was read as flaky infrastructure. That
diagnosis was wrong, and its real cost was that it ended the investigation every
time: "flaky" explains any failure and predicts nothing. What changed was
opening one artefact instead of re-running the job.

| Bug | Caught by | Smell | Status |
|-----|-----------|-------|--------|
| **BUG-001** — settings don't reach guests | J2 (cross-client) | Settings in per-client nav state; guests reach `/capture` via a different `navigate()` | ✅ Fixed |
| **BUG-002** — `/join` misleading error for non-existent codes | `negative-join-paths` | One `toast.error` covered two semantically different early-returns | ✅ Fixed |
| **BUG-004** — timer toast fires on unrelated party updates | `timer-toast-staleness` | A realtime handler compared against state its effect never re-read | ✅ Fixed |
| **BUG-005** — duplicate participant in the lobby | CI, not a local run | An INSERT subscription appended blindly to a list the initial fetch had already filled | ✅ Fixed |
| **BUG-006** — stuck on the voting screen after a dropped Realtime event | J3 in CI | A polling fallback guarded on `voting_ends_at` being *set*, treating "set" as "current" | ✅ Fixed |
| **BUG-008** — `/capture/:code` spins forever when the party does not resolve | `unresolvable-party` | A refetch written as `if (data) {…}` with no else, doubling as the page's initial loader | ✅ Fixed |
| **BUG-009** — one session, two anonymous identities | `auth-flow` — for three weeks, unbelieved | An effect that signs in when `getSession()` returns null, in a tree wrapped in `StrictMode` | ✅ Fixed |

BUG-003 and BUG-010 are deliberately not in this table: no test found either.
Their tests were written afterwards, to close the class of defect. Keeping the
table honest about which bugs a test actually caught is what stops the count
flattering the suite.

---

### ✅ BUG-001 — Party settings don't propagate to guests

**What happened.** The host's settings reached `/capture` through react-router
navigation state, which is per-client. Guests arrive another way, so a host who
picked 7 challenges got 7 and every guest got the default 5.

**Why earlier tests missed it.** J1 and J3 used default settings, so host and
guest agreed by coincidence. Only a multi-client test with a non-default value
could see the split: `Expected: 7 · Received: 5`.

**Fix.** The settings became columns on `parties`; every client reads them from
the row. **Guard:** J2, extended with a non-default value.

---

### ✅ BUG-002 — `/join` shows the wrong error for codes that never existed

**What happened.** One `toast.error` covered two failures. A code that never
existed got *"This party is no longer accepting new players"* — so a player who
mistyped one digit was told their friend's party was over.

**Fix.** Two branches, two messages: an unknown code now gets *"Party not found.
Check the code and try again."* **Guard:** `negative-join-paths.spec.ts`, three
cases.

*Blocking worked; the diagnosis lied. Guiding Rule 2 in `TEST_STRATEGY.md`
comes from this one.*

---

### ✅ BUG-003 — 72h retention had silently stopped

**What happened.** Parties are meant to be deleted after 72 hours (MO-001). For
five weeks, none were. When the backend moved to a new Supabase project in June,
the cleanup function was never deployed there — and the daily schedule that
called it had been set up by hand in the old project's dashboard, so it did not
come along either.

**Why nothing caught it.** 114 tests were green the whole time. The cleanup
code was correct and unit-tested; what was missing was the deployment. Every
test checked how the app behaves, and none checked that the infrastructure it
depends on actually exists.

**How it was found.** By hand, checking what had survived the move: the
function's address answered `404`. No real data was affected — the backlog was
22 test parties.

**Fix.** The function was deployed, the backlog cleared, and the daily schedule
moved into the repository (`.github/workflows/cleanup.yml`), where it is
versioned and cannot be lost with a dashboard.

**Guard.** A new kind of test rather than another assertion:
`edge-function-deployment.spec.ts` checks that every function in the repository
answers on the live project, plus a control probe proving that a function which
does not exist *does* return `404` — so the check cannot pass by accident. It
runs on every pull request. It proves the function is reachable; the
workflow's run history proves it runs.

*A suite that only exercises the application can only find bugs in the
application.*

---

### ✅ BUG-004 — A notification fires when nothing happened

**How it surfaced.** A `react-hooks/exhaustive-deps` lint warning, not a test.
The suite was entirely green, because nothing asserted how *often* a
notification fires.

**Cause.** The realtime handler compared incoming rows against a `party.ends_at`
frozen when the channel opened. After one timer change, every later update to
the party looked like a timer change, and fired a toast.

**Fix.** The latest `ends_at` lives in a ref. Adding it to the subscription's
dependencies would also have worked, at the cost of reopening the channel on
every timer change — the exact window where a phase transition goes missing.

**Guard.** `timer-toast-staleness.spec.ts`, on the third attempt. The first two
were green against the broken code: the countdown ticks on its own, and a toast
can vanish between two snapshots. The working version samples the DOM across a
6 s window and proves delivery with a value the clock cannot produce.

*A negative assertion is only as strong as its proof that the triggering event
occurred.*

---

### ✅ BUG-005 — The same person, listed twice

**How it surfaced.** A red CI run on a suite that was 28/28 locally. The DOM
snapshot showed the host listed twice in the lobby.

**Cause.** The lobby fills from a one-off fetch *and* appends INSERT events
without checking. The host's own INSERT event can land after the fetch — rarely
on a laptop, often on a CI runner.

**Fix.** The merge moved to `participantRules.mergeParticipant`, idempotent by
`id`. **Guard:** 8 unit tests on that rule. A race cannot be asserted
deterministically end to end; the rule that makes it harmless can.

*When a test fails only in CI, read the artefact before blaming the
environment.*

---

### ✅ BUG-006 — One dropped message, permanent divergence

**How it surfaced.** Journey 3 failed in CI: the host reached `/results`, a
guest stayed on `/vote`. The trace showed both guests made **zero** requests
after the host moved the deadline — they never learned anything had changed.

**Cause.** The polling fallback in `Vote.tsx` switched off as soon as
`voting_ends_at` held a value, treating *set* as *current*. A client that missed
one Realtime update kept a stale deadline, and the safety net was off exactly
when it was needed.

**Fix.** The poll runs for the whole voting phase, and the architecture
principle *"never poll"* became *"real-time first, polling as the safety net"*.
**Guard:** J3.

*A fallback conditioned on the presence of data is not a fallback.*

---

### ✅ BUG-007 — The page that could not see its own deadline

**Found by the TypeScript compiler, not a test.** A player on `/vote/:code`
while capture was still open stayed on *"Capture time isn't over yet…"* forever
after the deadline passed — five runs out of five.

**Cause.** The phase was derived from `new Date()` and woken by a counter that
nothing ever incremented; the compiler flagged its unused setter.
`CaptureMode.tsx` had the correct version of the same effect all along.

**Why no test saw it.** Every fixture seeded a deadline already in the past, so
thirty green tests never crossed the boundary.

**Fix.** When the deadline lies ahead, schedule a timer for it. **Guard:**
`locked-phase-transition.spec.ts`, the only spec that lets a future deadline
pass with the page open — 5/5 red before the fix, 5/5 green after.

*A suite that always seeds the far side of a boundary cannot test the crossing.*

---

### ✅ BUG-008 — The page with no answer for "this party is gone"

**Found by re-reading an item filed as untestable.** No client can delete a
party — there is no `DELETE` policy on `parties` — so what a connected client
does when its party vanishes looked untestable. But the state a deletion leaves
behind, a code that resolves to nothing, is one URL away.

**Confirmation.** One test, three routes, an unused code: `/vote` and `/results`
redirected Home; `/capture` spun on *"Loading challenges…"* forever.

**Cause.** `CaptureMode.refetchParty` was `if (partyData) {…}` with no `else`,
and it doubled as the page's initial loader.

**Fix.** An early return with a toast and a redirect Home, as the other two
pages already did. **Guard:** `unresolvable-party.spec.ts`.

*When something is filed as untestable, check whether the unreachable thing is
the state or the transition into it.*

---

### ✅ BUG-009 — One session, two anonymous identities

**What happened.** Every fresh page load created **two** anonymous accounts for
the same visitor instead of one, and kept whichever finished last. IA-002 — one
identity per session — was false on every cold load of the build the tests run
against.

**Why it went unseen for three weeks.** It did not go unseen. `auth-flow.spec.ts`
failed twice in CI, with two different user ids in its output, and both times
the failure was read as flaky infrastructure and re-run. The test was right; the
reading of it was wrong.

**How it was confirmed.** By counting sign-up requests on a fresh load: two in
the development build the tests are served, one in the production build. The
artefact of an earlier failed CI run showed the same thing — two sign-ups one
millisecond apart.

**Cause.** In development, React runs start-up effects twice on purpose, to
surface exactly this kind of bug. Both runs found no session, and both signed in.

**Why it looked random.** The bug happened on every load, but a test only
noticed when it read the user id in the ~20 ms between the two sign-ins — rare
on a laptop, common on a slower CI machine. It also spent a second sign-in per
browser context, around 29 per run: part of the quota problems it was mistaken
for.

**Fix.** Start-up now signs in once, even when it runs twice.

**Guard.** `auth-flow.spec.ts` gained a test that counts sign-ins on a cold load
and asserts exactly one — seen red on the broken build, green on the fixed one.

*A test that fails intermittently with valid-looking data is reporting a race,
not noise.*

---

### ✅ BUG-010 — The player who was refused, and never told

**Hypothesis**, formed while measuring BUG-009: if anonymous sign-in fails, what
does the player see?

**Confirmation.** With every sign-in answered `429` against the production
build, the page rendered its loading skeleton forever — visible text `""`, no
error, no control.

**Cause.** `AuthProvider` waited on `loading || !user`, which is true both while
sign-in is in flight and after it has failed for good. The sign-in cap is per
IP, so a venue's wifi or a party hotspot can spend it.

**Fix.** Three attempts with backoff, then an error screen with a working retry
(IA-007). **Guard:** `auth-signin-failure.spec.ts` fulfils a real `429`, asserts
the error screen, then lifts the refusal and asserts the retry recovers.

*A loading state that cannot tell "not yet" from "never" will render the wrong
one forever.*

---
