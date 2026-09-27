# Traceability — LastShots

**The chain from a requirement to the test that verifies it to the bug that
violated it.** A requirement's text lives in [`SPECS.md`](./SPECS.md), a test's
rationale in [`TEST_STRATEGY.md`](./TEST_STRATEGY.md), what a run reported in
[`TEST_RESULTS.md`](./TEST_RESULTS.md). This file says only: which test, at
which layer, for which requirement, and which bug.

---

## The chain is enforced, not asserted

Every test file declares what it covers, in its first lines:

```ts
// @covers IA-001, IA-002, IA-005, IA-006
// @regression BUG-009
```

`npm run check:docs` reconciles those declarations against this document in
**both** directions, and fails the build on any of:

| Failure | What it means |
|---|---|
| This file cites a test that is not on disk | a rename or deletion orphaned a row |
| This file cites a test that does not `@covers` that requirement | the row claims coverage the test does not claim |
| A test `@covers` a requirement this file does not list against it | the test claims coverage the matrix has not recorded |
| A test `@covers` an ID that is not in `SPECS.md` | a typo, or a requirement that was removed |
| A requirement in `SPECS.md` appears in no row here | a requirement with no traceability entry at all |
| A bug in the [inventory below](#bug--requirement--guard) has no `@regression` guard declared anywhere | a fixed bug with no test standing behind the fix |

A matrix typed by hand and checked by nobody is a claim; one that fails the
build when it drifts is evidence. The first run of this check found five wrong
rows.

---

## Legend

**Status**

- ✅ **Covered** — at least one automated test asserts this requirement.
- 🟡 **Implicit** — enforced by infrastructure (an RLS policy, a DB constraint,
  a Supabase primitive), with no test asserting it directly.

**47 of 50 are ✅; the three 🟡 rows are IA-003, PM-002 and PS-005.** There is
no "partial": a requirement is asserted by a test or it is not. IA-003 rests on
the RLS policy set and PM-002 on Postgres UUID generation — asserting them
directly would test Supabase rather than LastShots. PS-005 is the weaker one:
the foreign keys on `photos` guarantee each id exists, never that the three
agree, and the suite does not assert that negative — see *Deliberate boundaries*
in `TEST_STRATEGY.md`. The cost, stated plainly: if that infrastructure were
removed, no test would go red *for these three*.

**Requirement** — the gist of the rule, so a row can be read without opening
another file. [`SPECS.md`](./SPECS.md) holds the normative wording; where the two
differ, `SPECS.md` is the one that counts.

**Layer** — which tier of the pyramid carries the assertion.

| Layer | Runs | Cost |
|---|---|---|
| `Unit` | every PR, whatever it targets | ~40s, no quota |
| `Flow` | `@smoke` subset on PRs to `main`; all of it on push to `main` | anon sign-ins |
| `Journey` | push to `main` only | anon sign-ins |
| `Load` | push to `main`, after E2E; or on demand | anon sign-ins |
| `DB` | assertion lands in Postgres — a trigger or an RLS policy refusing the write | — |
| `CI` | a workflow, not a test file | — |
| `Infra` | 🟡 rows: no test, named here so the absence is visible | — |

**Gate** — `@smoke` marks a test in the tier that gates every PR targeting
`main`. Everything else is first exercised after merge. The reasoning, and the
one regression guard deliberately outside the gate, are in
[`TEST_STRATEGY.md`](./TEST_STRATEGY.md#ci-tiers).

**Shorthands** — `J1` = `journeys/host-creates-party.spec.ts`, `J2` =
`journeys/guest-full-journey.spec.ts`, `J3` =
`journeys/full-party-simulation.spec.ts`. Unit tests are under `tests/unit/`,
flow tests under `tests/e2e/flows/`, load tests under `tests/load/`.

---

## 1. Identity & Access

| Req | Requirement | Status | Layer | Verified by | Gate | Bugs |
|---|---|---|---|---|---|---|
| IA-001 | A persistent, unique `userId` per user | ✅ | Flow | `auth-flow.spec.ts` — an anonymous identity exists and is stable. Exercised incidentally by every other E2E test, each of which signs in anonymously; this file is the one that *asserts* it. | `@smoke` | — |
| IA-002 | Exactly one identity per session | ✅ | Flow | `auth-flow.spec.ts` — two assertions, deliberately. *"identical before and after reload"* is the consequence a player would notice; *"a cold load provisions exactly one identity"* is the requirement read literally, counted at the network layer. | `@smoke` | **BUG-009** |
| IA-003 | Party content requires an authenticated user | 🟡 | Infra | RLS policies in `supabase/migrations/`. Every E2E runs under them, so a policy that stopped existing would surface as a cascade of unrelated failures — but nothing asserts the policy set itself. | — | — |
| IA-004 | Unauthorized or unauthenticated actions are rejected | ✅ | Flow | `rls-isolation.spec.ts` (cross-party write rejected, cross-party read returns an empty set); `situation-pool-lockdown.spec.ts` (the anon key cannot read, insert, update or delete the shared prompt pool) | `@smoke` | — |
| IA-005 | Identity is anonymous and provisioned on first access | ✅ | Flow | `auth-flow.spec.ts` — no credentials are requested; identity is created on first visit | `@smoke` | — |
| IA-006 | The session survives a hard reload | ✅ | Flow · Journey | `auth-flow.spec.ts`; J2 reload checkpoints (capture counter and vote counter both survive a hard reload) | `@smoke` (flow only) | — |
| IA-007 | A failed sign-in surfaces an error and a retry, never a spinner | ✅ | Flow | `auth-signin-failure.spec.ts` — a 429'd sign-in surfaces an error screen with a retry control, and the retry recovers once the refusal lifts. Verified red before the fix, green after. | `@smoke` | **BUG-010** |

## 2. Party Management

| Req | Requirement | Status | Layer | Verified by | Gate | Bugs |
|---|---|---|---|---|---|---|
| PM-001 | A user can create a party | ✅ | Journey | J1, J2, J3 | — | — |
| PM-002 | A unique `partyId` per party | 🟡 | Infra | Supabase UUID generation. A uniqueness test would be testing Postgres, not this product. | — | — |
| PM-003 | Settings have defaults and are editable while **waiting** | ✅ | Flow · Journey | `party-settings.spec.ts`; J1 (settings dialog opens with all four controls) | `@smoke` (flow only) | — |
| PM-004 | Settings are immutable once the party is **playing** | ✅ | Flow · **DB** | `settings-immutable.spec.ts` — two layers: the host has no UI path to settings post-start, **and** the `party_settings_locked` trigger refuses the four settings columns at the database, with a control probe proving it does not simply reject every UPDATE | `@smoke` | — |
| PM-005 | A join code or link exists from creation | ✅ | Unit · Journey | `partyRules.test.ts` (`isValidPartyCode`); J1 (6-digit code rendered in lobby) | — | — |
| PM-006 | The host sets the four settings from the lobby | ✅ | Unit · Flow · Journey | `party-settings.spec.ts` (`max_situations` reaches CaptureMode); `vote-cap.spec.ts` (`max_votes` reaches Vote, seeded non-default so a hard-coded constant fails the first assertion); `rpc-column-contract.spec.ts` (the RPC declares every column, so a setting cannot ship inert); `dbContracts.test.ts` (the sibling RPC's payload is parsed, not cast); J1 | `@smoke` (three flows) | — |
| PM-007 | The host's settings read identically on every client | ✅ | Journey | J2 — host picks 7 situations, guest sees 7 in capture mode | — | **BUG-001** |
| PM-008 | Phase transitions propagate to all members in real time | ✅ | Flow · Journey | J3 (3 clients routed simultaneously through each phase via Realtime); `locked-phase-transition.spec.ts` (the deadline a page must observe on its own, with no Realtime event to carry it) | `@smoke` (flow only) | **BUG-006**, **BUG-007** |

## 3. Membership

| Req | Requirement | Status | Layer | Verified by | Gate | Bugs |
|---|---|---|---|---|---|---|
| MB-001 | Joining is allowed only while **waiting** or **playing** | ✅ | Flow | `negative-join-paths.spec.ts` — a party past its join window is refused | `@smoke` | — |
| MB-002 | The member list stays accurate | ✅ | Unit · Journey | `participantRules.test.ts` (the roster merge is idempotent, so a Realtime redelivery cannot duplicate a member); J3 (lobby shows exactly 3 participants) | — | **BUG-005** |
| MB-003 | Only members submit, vote and view results | ✅ | Flow | `rls-isolation.spec.ts` — a non-member is denied reads and writes on another party's participants, situations and photos | `@smoke` | — |
| MB-004 | Membership survives refresh or reconnect | ✅ | Journey | J2 — reload preserves membership and both counters | — | — |
| MB-005 | Only valid codes and links grant access | ✅ | Unit · Flow | `partyRules.test.ts` (`isValidPartyCode`); `negative-join-paths.spec.ts` (the format filter) | `@smoke` (flow only) | — |
| MB-006 | A failed join names its cause | ✅ | Flow | `negative-join-paths.spec.ts` — a code that never existed and a party that closed its window produce *different* messages | `@smoke` | **BUG-002** |
| MB-007 | A QR scan matches manual entry; 6 digits only | ✅ | Unit · Flow | `qr-scan-flow.spec.ts` (dialog opens and dismisses without mutating the input); `partyRules.test.ts` (the `/^\d{6}$/` filter a decoded payload must pass). Driving a decode through the camera is a **deliberate boundary** — see [`TEST_STRATEGY.md`](./TEST_STRATEGY.md#deliberate-boundaries). | — | — |

## 4. Prompt & Submission

| Req | Requirement | Status | Layer | Verified by | Gate | Bugs |
|---|---|---|---|---|---|---|
| PS-001 | Submissions only while **playing** | ✅ | Unit | `stateMachine.test.ts` (`canPerformAction("submit")`) | — | — |
| PS-002 | One prompt set, identical for every user | ✅ | Journey | J2, J3 — the situation set is identical across clients | — | — |
| PS-003 | A fixed number of submissions per user | ✅ | Unit · Journey | `submissionRules.test.ts` (`hasRemainingShots`, `MAX_SHOTS`); J3 (3/4/5 photos across three players) | — | — |
| PS-004 | At most one photo per prompt | ✅ | Unit | `submissionRules.test.ts` (`canSubmitToSituation`) | — | — |
| PS-005 | A photo is tied to the right user, prompt and party | 🟡 | Infra | Foreign-key constraints on `photos.party_id`, `participant_id`, `situation_id` — each id exists, not that the three agree. No test asserts a mismatched row is refused; recorded under *Deliberate boundaries*. | — | — |
| PS-006 | Invalid or unsupported files are rejected | ✅ | Unit | `submissionRules.test.ts` (`validatePhotoBlob`, the 15 MB limit and the MIME allow-list) | — | — |

## 5. Reveal & Voting

| Req | Requirement | Status | Layer | Verified by | Gate | Bugs |
|---|---|---|---|---|---|---|
| VT-001 | Voting only while **voting** | ✅ | Unit | `stateMachine.test.ts` (`canPerformAction("vote")`) | — | — |
| VT-002 | A fixed vote quota, set before the party starts | ✅ | Unit · Flow · **DB** | `voteRules.test.ts` (`hasRemainingVotes`); `vote-cap.spec.ts` (the UI reads `parties.max_votes`, seeded non-default, and the quota survives a reload); `vote-cap-server-side.spec.ts` (the **database** refuses vote `max_votes + 1` with `23514` under the participant's own session; the row count is read back; a removed vote frees its slot; eight simultaneous inserts at a quota of three leave three rows) | `@smoke` (`vote-cap`) | — |
| VT-003 | No voting for your own submission | ✅ | Unit | `voteRules.test.ts` (`isVoteAllowed` blocks a self-vote) | — | — |
| VT-004 | At most one vote per submission | ✅ | Unit · Flow · Load | `voteRules.test.ts`; `vote-cap.spec.ts`; `concurrent-voting.js` — `UNIQUE(photo_id, voter_id)` holds under a 150-attempt write storm | `@smoke` (`vote-cap`) | — |
| VT-005 | A repeated vote action counts once | ✅ | Unit · Load | `voteRules.test.ts` (`deduplicateVotes`); `concurrent-voting.js` — exactly one row persists after a duplicate-vote storm | — | — |

## 6. Results & Export

| Req | Requirement | Status | Layer | Verified by | Gate | Bugs |
|---|---|---|---|---|---|---|
| RS-001 | Results only in the **results** state | ✅ | Unit | `stateMachine.test.ts` (`canPerformAction("viewResults")`) | — | — |
| RS-002 | Results reflect only valid recorded votes | ✅ | Unit · Flow | `voteRules.test.ts` (`calculateScores`); `resultsRules.test.ts` (`computeResults`); `podium-correctness.spec.ts` | — | — |
| RS-003 | Final scores are identical for every user | ✅ | Journey | J3 — `podium(host) === podium(alice) === podium(bob)` | — | — |
| RS-004 | Ties are broken deterministically | ✅ | Unit · Flow | `voteRules.test.ts` (`tieBreakCompare`, including the equal-timestamp case); `resultsRules.test.ts`; `podium-correctness.spec.ts` (tie-break by earliest `captured_at`) | — | — |
| RS-005 | Export is available once results exist | ✅ | Flow | `results-export.spec.ts` — Save and Share controls are present once results exist, and the share preview opens. The requirement is *availability*, and availability is what is asserted; the `html2canvas` raster is a **deliberate boundary**. | — | — |
| RS-006 | Results are stable across refresh and sessions | ✅ | Flow · Journey | `results-display.spec.ts`; J2/J3 redirects to results | — | — |

## 7. Notifications & Player Reminders

| Req | Requirement | Status | Layer | Verified by | Gate | Bugs |
|---|---|---|---|---|---|---|
| NT-001 | Users are notified when the party changes state | ✅ | Flow · Journey | `timer-toast-staleness.spec.ts` (a notification fires once per *real* change and not on unrelated party updates); J2/J3 (Realtime-driven redirects between phases) | `@smoke` (flow only) | **BUG-004**, **BUG-006** |
| NT-002 | Time left is shown while **playing** and **voting** | ✅ | Flow | `countdown-timer-visible.spec.ts` — the countdown is rendered in both CaptureMode and Vote | — | — |
| NT-003 | Submissions left are shown while **playing** | ✅ | Journey | J3 — the capture counter tracked through `takePhotos` | — | — |
| NT-004 | Votes left are shown while **voting** | ✅ | Flow · Journey | `vote-cap.spec.ts`; J3 — the vote counter tracked through `castVotes` | `@smoke` (flow only) | — |

## 8. Moderation, Safety & Content Access

| Req | Requirement | Status | Layer | Verified by | Gate | Bugs |
|---|---|---|---|---|---|---|
| MO-001 | A party is deleted at most 72h after creation | ✅ | Unit · Flow · CI | `retentionRules.test.ts` (the 72h cutoff, asserted against `supabase/functions/_shared/retention.ts` — the module the deployed handler itself imports, so there is no second copy to drift); `edge-function-deployment.spec.ts` (every function in `supabase/functions/` still answers); `.github/workflows/cleanup.yml` (invocation, daily at 03:00 UTC — its run history is the evidence that something *calls* the function) | `@smoke` (flow only) | **BUG-003** |
| MO-002 | All access is fenced by RLS tied to `auth.uid()` | ✅ | Flow | `rls-isolation.spec.ts` (access fenced by RLS tied to `auth.uid()`); `situation-pool-lockdown.spec.ts`; and every other E2E, each of which runs under real RLS | `@smoke` | — |
| MO-003 | Photos live in private buckets, reachable only by signed URL | ✅ | Flow | `storage-privacy.spec.ts` — an uploaded photo returns no bytes over its public URL *or* its raw object path; a valid signed URL returns the exact bytes, as a control | `@smoke` | — |
| MO-004 | A signed URL expires after 7 days | ✅ | Unit · Flow | `storage-privacy.spec.ts` (**mechanism**: a short-TTL signed URL works inside its window, is refused once it passes, and a forged token is refused); `storageRules.test.ts` (**policy**: `SIGNED_URL_TTL_SECONDS` is 7 days and outlives the 72h retention window). Splitting the requirement into those two halves is what made both testable — see [`TEST_RESULTS.md`](./TEST_RESULTS.md). | `@smoke` (flow only) | — |
| MO-005 | A party that stops resolving surfaces an error, never a spinner | ✅ | Flow | `unresolvable-party.spec.ts` — a code resolving to nothing leaves a usable screen on `/capture`, `/vote` and `/results`. This is the reachable half; the *transition* into that state is unreachable because no client session holds a `DELETE` policy. Both paths converge on the same branch before the client sees them. | `@smoke` | **BUG-008** |

## 9. Accessibility

Both requirements are verified by the same pair of specs, across **every route
in the app** — `a11y-smoke.spec.ts` (Home, Create, Join, 404: no fixture, one
sign-in, in the gate) and `a11y-phases.spec.ts` (lobby, capture, vote, results:
one fixture per phase, full suite only). Neither asserts these two rules
specifically: both assert the whole serious/critical axe class, of which these
are the members that have actually fired. The test over-delivers against the
spec, which is the safe direction.

| Req | Requirement | Status | Layer | Verified by | Gate | Bugs |
|---|---|---|---|---|---|---|
| AC-001 | Every interactive control exposes an accessible name | ✅ | Flow | `a11y-phases.spec.ts` — red before the fix on `button-name` × 2 (`lobby-back-btn` and `qr-code-display-btn` each wrapped a bare `<svg>`, announced as "button" with no name), green after; `a11y-smoke.spec.ts` | `@smoke` (smoke spec) | — |
| AC-002 | Text meets the WCAG 2.1 AA contrast minimum | ✅ | Flow | `a11y-phases.spec.ts` — red before the fix on `color-contrast` × 1 (the podium wordmark at 2.09:1 against the 4.5:1 floor), green after; `a11y-smoke.spec.ts` | `@smoke` (smoke spec) | — |

---

## Bug → requirement → guard

**This table is the bug inventory** — one row per bug, all ten resolved, and the
list `npm run check:docs` reads when it checks that every bug has a write-up in
[`TEST_RESULTS.md`](./TEST_RESULTS.md#bugs-confirmed-by-tests), a mention in
`README.md` and a declared `@regression` guard. How each was found, what
confirmed it and what the fix was are in those write-ups. What this table adds
is **whether the guard gates a PR, or is first exercised after merge.**

| Bug | Requirement violated | Regression guard | In the PR gate? |
|---|---|---|---|
| **BUG-001** party settings did not reach guests | PM-007 | J2 | ❌ after merge |
| **BUG-002** `/join` misidentified the failure | MB-006 | `negative-join-paths.spec.ts` | ✅ `@smoke` |
| **BUG-003** 72h retention silently stopped | MO-001 | `edge-function-deployment.spec.ts` | ✅ `@smoke` |
| **BUG-004** a notification fired on nothing | NT-001 | `timer-toast-staleness.spec.ts` | ✅ `@smoke` |
| **BUG-005** a player rendered twice | MB-002 | `participantRules.test.ts` | ✅ **unit tier** — every PR, quota-free |
| **BUG-006** a missed Realtime message stranded a client | PM-008, NT-001 | J3 | ❌ **after merge — the documented exception** |
| **BUG-007** the locked phase never released | PM-008 | `locked-phase-transition.spec.ts` | ✅ `@smoke` |
| **BUG-008** an endless spinner on an unresolvable party | MO-005 | `unresolvable-party.spec.ts` | ✅ `@smoke` |
| **BUG-009** two identities per cold load | IA-002 | `auth-flow.spec.ts` | ✅ `@smoke` |
| **BUG-010** a rate-limited player saw nothing | IA-007 | `auth-signin-failure.spec.ts` | ✅ `@smoke` |

**Nine of ten guards gate a PR.** BUG-006's does not, and that is a priced
decision rather than an oversight: Journey 3 is the only guard for a
dropped-Realtime-message defect that was live for roughly seven months, and it
now runs only after merge, bought for a 4.6× faster gate. It rests on two
stated conditions — a recurrence shows up on `main` within one push, and a red
`main` gets investigated the same day — with an explicit revert trigger if the
second ever stops holding. The full argument is in
[`TEST_STRATEGY.md`](./TEST_STRATEGY.md#ci-tiers); it is surfaced here because a bug-to-guard
table that hid its one exception would be the wrong kind of tidy.