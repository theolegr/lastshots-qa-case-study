# Architecture — LastShots

How the application is built: file layout, data model, API surface, conventions.

> The lifecycle state machine is a **requirement**, not an implementation detail — it lives in [`SPECS.md`](./SPECS.md#state-model). Phase is derived by `src/lib/stateMachine.ts:getPartyPhase()`.

**Stack:** Vite + React 18 + TypeScript, Supabase (anonymous auth, Postgres + RLS, private storage, Realtime), Tailwind + shadcn-ui, React Router, TanStack Query.

---

## File Structure

### Pages (`src/pages/`)
| File | Purpose |
|------|--------|
| `Home.tsx` | Landing page with Create/Join buttons, lists user's parties — the `/` route, eagerly loaded |
| `CreateParty.tsx` | Form to create party (name + host nickname) |
| `JoinParty.tsx` | Form to join via 6-digit code or QR scan |
| `PartyLobby.tsx` | Waiting room, participants, host settings + start |
| `CaptureMode.tsx` | Photo capture UI, situation cards, camera overlay |
| `Vote.tsx` | Voting phase: locked → voting transition, photo grid |
| `Results.tsx` | Podium, situation winners, all photos |
| `NotFound.tsx` | 404 page |

### Core Logic (`src/lib/`)

`api.ts` owns I/O. Everything else is pure and side-effect-free — which is what makes it unit-testable. See [Pure Logic Modules](#pure-logic-modules) below and the rationale in [`TEST_STRATEGY.md`](./TEST_STRATEGY.md#extracting-logic-to-make-it-testable).

| File | Purpose |
|------|--------|
| `api.ts` | All Supabase operations |
| `dbContracts.ts` | Row types derived from the generated schema, plus the three runtime boundaries a derived type cannot cover: `toParty` (the `status` CHECK constraint), `parseCreatePartyPayload` (opaque `jsonb`) and `partyFromRealtime` / `participantFromRealtime` (untyped socket payloads) |
| `stateMachine.ts` | Phase derivation, allowed transitions, per-phase action gating |
| `partyRules.ts` | Zod schemas for party creation and join input |
| `submissionRules.ts` | Photo size limit, shot cap, per-situation submission guard |
| `voteRules.ts` | Self-vote guard, vote quota, deduplication, score tally, tie-break |
| `resultsRules.ts` | `computeResults` — podium ranking and per-situation winners |
| `storageRules.ts` | Signed-URL TTL policy and photo object-key format |
| `devTools.ts` | `SHOW_DEBUG_TOOLS` — dev-only gate for host debug timers |
| `utils.ts` | Tailwind `cn()` helper |

### Hooks (`src/hooks/`)
| File | Purpose |
|------|--------|
| `useAuth.ts` | Re-exports `useAuthContext` |
| `useCamera.ts` | Camera access, capture, front/back switch |
| `useCurrentParticipant.ts` | Participant record for current user in party |
| `usePartyGuard.ts` | Redirects non-participants to home |
| `useUserParties.ts` | React Query hook for user's party list |

### Contexts (`src/contexts/`)
| File | Purpose |
|------|--------|
| `AuthContext.tsx` | Supabase auth state, anonymous sign-in |

### Components (`src/components/`)
| File | Purpose |
|------|--------|
| `AuthProvider.tsx` | Loading gate for auth initialization |
| `AuthErrorScreen.tsx` | Shown when anonymous sign-in fails for good; carries the retry (IA-007) |
| `CountdownTimer.tsx` | Countdown display (compact or full) |
| `LobbyDrawer.tsx` | Side drawer showing party info |
| `LockedPhoto.tsx` | Blurred photo placeholder |
| `PageSkeleton.tsx` | Suspense fallback for lazy routes |
| `ParticipantAvatar.tsx` | Avatar with emoji + name |
| `PartySettingsDrawer.tsx` | Host-only settings; exports `PartySettings`, `DEFAULT_PARTY_SETTINGS` |
| `QRCodeDisplay.tsx` | QR code modal for sharing party code |
| `QRScanner.tsx` | Camera-based QR scanner |
| `ShotIndicator.tsx` | Visual indicator of shots remaining |
| `SituationCard.tsx` | Challenge card (completed/locked states) |
| `YourParties.tsx` | Party list with phase indicators |

### Voting Components (`src/components/voting/`)
| File | Purpose |
|------|--------|
| `SituationAccordion.tsx` | Collapsible photo grid per situation |
| `PhotoFullscreen.tsx` | Full-screen photo with vote area |
| `ResultsPhotoFullscreen.tsx` | Full-screen photo in results |
| `PodiumShareable.tsx` | Podium + shareable image export (html2canvas) |
| `SituationWinners.tsx` | Winner per situation |
| `VotingHeader.tsx` | Header with timer |

### UI Primitives (`src/components/ui/`)

shadcn-ui components, pruned to the 9 actually reachable from application code:
`alert-dialog`, `badge`, `button`, `dialog`, `drawer`, `input`, `sheet`,
`skeleton`, `sonner`. Toasts are sonner only.

### Supabase (`src/integrations/supabase/`)
| File | Purpose |
|------|--------|
| `client.ts` | Supabase client initialization (reads `import.meta.env`) |
| `types.ts` | Generated TypeScript types from the schema |

### Edge Functions (`supabase/functions/`)
| Function | Purpose |
|----------|---------|
| `cleanup-old-parties/` | Deletes parties older than 72h. Invoked daily by `.github/workflows/cleanup.yml`, not `pg_cron`. `verify_jwt = false` — **probe it with `OPTIONS` only** (`index.ts:10-12` returns early; every other method deletes). Why it is open is in [`TEST_STRATEGY.md` → *Deliberate boundaries*](./TEST_STRATEGY.md#deliberate-boundaries). |
| `_shared/retention.ts` | The retention *rule*, extracted from the handler so a unit test can import the same file the function deploys |

---

## Naming Conventions

**Files** — Pages and components: PascalCase (`CreateParty.tsx`). Hooks: camelCase with `use` prefix (`useCamera.ts`). Contexts: PascalCase + `Context` suffix.

**Code** — Components: PascalCase. Functions and variables: camelCase. Constants: SCREAMING_SNAKE_CASE. Types and interfaces: PascalCase. Database columns: snake_case.

**State values** — Party status: `"waiting" | "playing"`. Camera facing: `"user" | "environment"`. Derived phase: `"waiting" | "playing" | "voting" | "results"`.

### Test selectors (`data-testid`)

Every interactive element carries a `data-testid`, named `{page-or-component}-{element}-{type}` in kebab-case. The suite is testid-first — why, and when it falls back to `getByText` or `getByRole`, is in [`TEST_STRATEGY.md`](./TEST_STRATEGY.md#locator-strategy). The registry lives here because it describes the components, not the tests.

| Selector | Defined in |
|----------|------------|
| `home-create-party-btn` / `home-join-party-btn` | `Home.tsx` |
| `create-party-back-btn` / `create-party-name-input` / `create-party-nickname-input` / `create-party-submit-btn` | `CreateParty.tsx` |
| `join-party-back-btn` / `join-party-code-input` / `join-party-nickname-input` / `join-party-qr-scan-btn` / `join-party-submit-btn` | `JoinParty.tsx` |
| `lobby-back-btn` / `lobby-copy-code-btn` / `lobby-party-code` / `lobby-start-party-btn` / `lobby-settings-btn` | `PartyLobby.tsx` |
| `capture-back-btn` / `capture-close-camera-btn` / `capture-switch-camera-btn` / `capture-shutter-btn` / `capture-retake-btn` / `capture-save-btn` / `capture-debug-timer-btn` / `capture-end-party-btn` / `capture-end-party-cancel-btn` / `capture-end-party-confirm-btn` | `CaptureMode.tsx` |
| `vote-back-btn` / `vote-debug-timer-btn` / `vote-back-to-capture-btn` | `Vote.tsx` |
| `results-back-btn` / `results-photo-item` / `results-participants-grid` | `Results.tsx` |
| `auth-error-screen` / `auth-error-retry-btn` | `AuthErrorScreen.tsx` |
| `countdown-timer` | `CountdownTimer.tsx` |
| `lobby-drawer-trigger-btn` / `lobby-drawer-copy-code-btn` | `LobbyDrawer.tsx` |
| `settings-capture-hours` / `settings-voting-hours` / `settings-max-situations` / `settings-max-votes` | `PartySettingsDrawer.tsx` — passed as `Segmented`'s `testId` prop, one per group, so a label like "7" is addressable within its own control |
| `qr-code-display-btn` | `QRCodeDisplay.tsx` |
| `qr-scanner-retry-btn` | `QRScanner.tsx` |
| `situation-card-btn` | `SituationCard.tsx` |
| `situation-accordion` (root) / `situation-accordion-header-btn` / `situation-accordion-photo-btn` | `SituationAccordion.tsx` — the root testid is what scopes photo lookups to one accordion |
| `photo-fullscreen-close-btn` / `photo-fullscreen-vote-area` | `PhotoFullscreen.tsx` |
| `podium-entry-{1,2,3}` / `podium-save-btn` / `podium-share-btn` / `podium-share-cancel-btn` / `podium-share-now-btn` | `PodiumShareable.tsx` — the entries are templated from `result.position` and carry participant name + vote count as text, which is what `readPodium` reads |
| `your-parties-card-btn` | `YourParties.tsx` |

Two are not literal strings in the component that renders them, so grepping for `data-testid` alone will miss them: `podium-entry-N` is built from `result.position`, and the four `settings-*` ids are props passed into `Segmented`.

---

## API Inventory (`src/lib/api.ts`)

| Function | Purpose |
|----------|---------|
| `createParty(partyName, hostName)` | Creates party via RPC, returns participant plus a full `Party` |
| `joinParty(code, userName)` | Joins existing party, creates participant |
| `getPartyByCode(code)` | Fetches party by 6-digit code (RPC) |
| `getCurrentParticipant(partyId)` | Participant record for current user |
| `getPartyParticipants(partyId)` | Lists all participants |
| `getPartySituations(partyId)` | Lists all challenges/prompts |
| `startParty(partyId, settings?)` | Sets status `playing`, `ends_at` to +captureHours, persists `capture_hours` / `voting_hours` / `max_situations` / `max_votes` |
| `endParty(partyId)` | Sets `ends_at` to now (triggers voting phase) |
| `debugSetRevealTime(partyId, seconds)` | Debug: sets `ends_at` to now + seconds |
| `debugSetVotingEndTime(partyId, seconds)` | Debug: sets `voting_ends_at` to now + seconds |
| `uploadPhoto(partyId, participantId, situationId, blob)` | Uploads to storage, creates record |
| `getPartyPhotos(partyId)` | Fetches all photos for party |
| `startVotingPhase(partyId, votingHours)` | Sets `voting_ends_at` to +votingHours |
| `submitVote(photoId, voterId)` / `removeVote(photoId, voterId)` | Cast / withdraw a vote |
| `getParticipantVotes(participantId)` | Votes cast by a participant |
| `getPartyVotes(partyId)` | All votes for a party's photos |
| `getVoteResults(partyId, photos, situations, participants)` | Fetches votes, delegates ranking to `resultsRules.computeResults` |
| `getUserParties()` | All parties for current user (last 72h) |
| `getRecentNickname()` | User's most recent nickname |

### Supabase RPC functions

| Function | Purpose | Called from |
|----------|---------|-------------|
| `create_party_with_host(_party_name, _host_name)` | Atomic party + host + situations creation | `api.ts` |
| `get_party_by_code(_code)` | Fetches party by code (bypasses RLS for joining) | `api.ts` |
| `sync_party_situations(_party_id, _target)` | Resizes a party's situation list to `_target` | trigger only |
| `enforce_vote_quota()` | `BEFORE INSERT` on `votes`: counts the voter's votes for the party and refuses the one past `parties.max_votes` (`23514`). `SECURITY DEFINER` so the count is authoritative rather than filtered by the caller's own `View party votes` policy; takes `pg_advisory_xact_lock` on the voter so two simultaneous inserts cannot both read a count below the quota | trigger only |
| `is_party_participant(_party_id, _user_id)` | RLS helper | policies |
| `is_party_host(_party_id, _user_id)` | RLS helper | policies |

Application code calls only the first two directly. All are `SECURITY DEFINER`.

### How situations are seeded

`create_party_with_host` inserts 12 hard-coded situations; the UI shows the first
`parties.max_situations` of them (default 5). Changing that setting fires the
`reroll_situations_on_count_change` trigger, which trims the list and tops it up
from `situation_pool` (30 seeded rows).

---

## Data Model

### `parties`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK |
| `code` | VARCHAR(6) | Unique join code |
| `name` / `host_name` | TEXT | |
| `status` | TEXT | `waiting` / `playing` |
| `created_at` | TIMESTAMPTZ | |
| `ends_at` | TIMESTAMPTZ | When capture ends (reveal time) |
| `voting_ends_at` | TIMESTAMPTZ | When voting ends |
| `capture_hours` | NUMERIC | Capture window (default 12) |
| `voting_hours` | NUMERIC | Voting window (default 2) |
| `max_situations` | INTEGER | Situations shown (default 5) |
| `max_votes` | INTEGER | Votes per player (default 5, `CHECK > 0`). May exceed `max_situations` — several votes in one situation is a valid configuration. |

### `participants`
`id` (PK) · `party_id` → parties · `user_id` → auth.users · `name` · `avatar_emoji` · `is_host` · `joined_at`

### `situations`
`id` (PK) · `party_id` → parties · `title` · `display_order`

### `situation_pool`
`id` (PK) · `text` · `is_active` · `created_at`. 30 seeded rows.
Global, not per-party. RLS enabled with **zero policies** — reachable only
through `sync_party_situations` (`SECURITY DEFINER`).

### `photos`
`id` (PK) · `party_id` · `participant_id` · `situation_id` · `image_url` (signed) · `captured_at`

### `votes`
`id` (PK) · `photo_id` → photos · `voter_id` → participants · `created_at` · **`UNIQUE(photo_id, voter_id)`** · index on `voter_id`

> Three rules guard this table: `UNIQUE(photo_id, voter_id)` against a repeat
> vote, the `Cast vote` policy against a non-member, a self-vote or a closed
> window, and the `enforce_vote_quota` trigger against the count — a trigger,
> because a `CHECK` cannot span rows.

### Storage
- **Bucket:** `party-photos` (private)
- **Path:** `{partyId}/{participantId}/{uuid}_{situationId}.jpg` — built by `storageRules.buildPhotoPath`; the first two segments are what the storage RLS policies match on
- **Signed URLs:** 7-day expiry (`storageRules.SIGNED_URL_TTL_SECONDS`)

### Row Level Security
RLS is enabled on every table. Participants only see and modify data for parties they belong to; storage access is restricted to party participants. `is_party_participant()` and `is_party_host()` are the helper functions. `situation_pool` has RLS enabled with **zero policies** — it is only ever read through a `SECURITY DEFINER` RPC.

---

## Real-time Subscriptions

Supabase Realtime propagates phase transitions. Channel naming: `party-{context}-{partyId}`.

- **PartyLobby** — participant inserts, party status updates
- **CaptureMode** — party updates (`status`, `ends_at`)
- **Vote** — party updates (`voting_ends_at`)

`postgres_changes` delivers the whole updated row, but `payload.new` has no generated type: handlers pass it through `partyFromRealtime` / `participantFromRealtime`, which validate it and return `null` rather than throwing, so a bad payload drops one event instead of the subscription.

---

## Pure Logic Modules

Each module has a matching test file under `tests/unit/`. Counts and coverage live in [`TEST_STRATEGY.md`](./TEST_STRATEGY.md).

### `stateMachine.ts`
| Function | Rule |
|----------|------|
| `getPartyPhase(party)` | `waiting` if status is waiting; `results` if `voting_ends_at` passed; `voting` if `ends_at` passed; else `playing` |
| `transition(from, to)` | Allows only `waiting→playing`, `playing→voting`, `voting→results`; throws otherwise |
| `canPerformAction(phase, action)` | `join`: waiting/playing · `submit`: playing · `vote`: voting · `viewResults`: results |

### `voteRules.ts`
| Function | Rule |
|----------|------|
| `isVoteAllowed(userId, photo)` | `false` if the voter authored the photo |
| `hasRemainingVotes(userId, votes, quota)` | `used < quota` |
| `deduplicateVotes(votes)` | Drops duplicate `(photo_id, voter_id)` pairs, keeps first |
| `calculateScores(votes)` | Tallies per photo, sorted descending |
| `tieBreakCompare(a, b)` | Comparator: earliest `captured_at` first |
| `resolveTie(a, b)` | Returns the earlier-captured photo |

**Tie-break, single source of truth:** equal vote counts → earliest capture wins. `tieBreakCompare` is the only implementation, used by `resolveTie` and by `resultsRules.computeResults`.

### `resultsRules.ts`
`computeResults({ votes, photos, situations, participants })` → `{ podium, situationWinners }`. Pure. Handles no votes, fewer than three photos, an unshot situation, a total tie, votes pointing at deleted photos, and authors missing from the participant list (`UNKNOWN_PARTICIPANT_NAME`). `PODIUM_SIZE` is 3.

### `submissionRules.ts`
| Function | Rule |
|----------|------|
| `validatePhotoBlob(blob)` | `"too_large"` above 15 MB, else `null` |
| `hasRemainingShots(used, max?)` | `used < max` (default 5) |
| `canSubmitToSituation(id, completed[])` | `true` if not already completed |
| `canSubmitPhoto(...)` | AND gate of the two above |

### `partyRules.ts`
| Schema | Fields |
|--------|--------|
| `PartySchema` | `name` trimmed 1–100; `hostName` trimmed 1–50 |
| `JoinSchema` | `name` trimmed 1–50; `code` exactly `^\d{6}$` |

`validatePartyInput` / `validateJoinInput` throw `ZodError`; `isValidPartyCode` returns a boolean.

### `storageRules.ts`
`SIGNED_URL_TTL_SECONDS` (7 days) and `buildPhotoPath(partyId, participantId, situationId, randomId)`. Both are security-relevant: the TTL is the policy half of MO-004, and the path's leading segments are what storage RLS authorises writes on.

### `supabase/functions/_shared/retention.ts`
The one pure module **not** under `src/lib`, deliberately: the edge function
imports this exact file, so the unit tests assert the deployed rule rather than
a copy of it. `RETENTION_HOURS` (72), `retentionCutoff(now)` and
`isPastRetention(createdAt, now)`, which throws rather than guessing on an
unparseable timestamp, because a silent `true` would delete data.

---

## Architecture Principles

Design intent — use as a checklist when adding features or reviewing changes.

- **The state machine is the source of truth.** Every party action is gated by current phase. Phase is derived from DB fields (`status`, `ends_at`, `voting_ends_at`), never stored separately. The backend (RLS + check constraints) enforces state, not just the frontend.
- **Photo visibility is server-controlled.** Photos are never reachable by direct URL before unlock. Private bucket; signed URLs issued at view time.
- **Idempotency.** Vote and submission writes tolerate retries and double-taps: `votes` has `UNIQUE(photo_id, voter_id)`; submission is one photo per `(participant, situation)`.
- **Optimistic UI must roll back on rejection.** A server rejection (RLS denial, constraint violation) must revert local state — no silent divergence.
- **Real-time is the primary path; polling is the safety net.** Realtime delivery is not guaranteed, and a client that misses one UPDATE cannot notice. This principle used to read *"never poll"*, which BUG-006 showed to be backwards, so `Vote.tsx` keeps low-frequency reconciliation polls alongside its subscriptions.

---

## Debug Tools (host only, dev builds only)

| Handler | File | Effect |
|---------|------|--------|
| `handleDebugSetRevealTimer()` | `CaptureMode.tsx` | `ends_at` → now + 3s; triggers capture → vote |
| `handleDebugSetVotingTimer()` | `Vote.tsx` | `voting_ends_at` → now + 3s; triggers vote → results |

Rendered via the `<Bug>` icon only when `SHOW_DEBUG_TOOLS && isHost`.

`SHOW_DEBUG_TOOLS` (`src/lib/devTools.ts`) is `import.meta.env.DEV`: the E2E suite, served `npm run dev`, keeps its phase-transition controls, and a production build contains none. Why a server-side timer rather than a mocked clock is in [`TEST_STRATEGY.md`](./TEST_STRATEGY.md).

---

## Development

### Commands

```bash
npm run dev          # Dev server on :8080
npm run build        # Production build
npm run preview      # Preview the production build
npm run lint         # ESLint
npm run typecheck    # tsc over src/ and tests/
npm test             # Unit tests (vitest)
npm run test:e2e     # Full Playwright suite
npm run check:docs   # Advertised test counts match disk
```

### Environment variables

Template in `.env.example` (tracked — `.gitignore` negates the `.env.*` rule for it). `.env` itself is never committed.

```
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_SUPABASE_PROJECT_ID=      # Supabase CLI only (migrations, type generation)
```

Neither value is a true secret — both are compiled into the frontend bundle. **No `service_role` key exists in this repo or in CI**: every E2E test runs under real RLS.

### Two Supabase projects

Split on 2026-06-26 so web/QA traffic could no longer disturb mobile state.

| Project | Backs | Anon sign-in limit |
|---------|-------|--------------------|
| `lastshots-web` | This repo — web app, CI, full test suite | 200/h (raised) |
| `lastshots` | The iOS port (separate repo) | ~30/h (default) |

Separate data, separate schema, separate products. Everything here targets
`lastshots-web` — `.env`, `supabase/config.toml:1` and both GitHub Actions
secrets — and no credential for the iOS project exists in this repo or in CI.

### Security notes

- `.env` is gitignored and untracked. Never commit it.
- The beta password gate was removed: a client-side constant compiled into the bundle gates nothing an attacker cannot read.
