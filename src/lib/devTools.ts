/**
 * Gate for the host-only debug affordances (the orange bug buttons that force
 * `ends_at` / `voting_ends_at` to `now + 3s`).
 *
 * These exist because a phase transition is driven by server timestamps that
 * are hours away — an E2E test cannot wait them out, and mocking the client
 * clock would bypass both the scheduling logic and the Realtime delivery path
 * the tests are there to exercise. See TEST_STRATEGY.md, "Phase transitions
 * use debug-timer buttons, not time mocks".
 *
 * `import.meta.env.DEV` is true under `vite dev` and false in a production
 * build, so the buttons stay reachable for the Playwright suite (whose
 * `webServer` runs `npm run dev`) while never shipping to real users — where
 * any host could otherwise end the capture window for everyone.
 */
export const SHOW_DEBUG_TOOLS = import.meta.env.DEV;
