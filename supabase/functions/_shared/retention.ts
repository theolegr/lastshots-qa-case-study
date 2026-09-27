/**
 * The retention policy of MO-001, as a pure module.
 *
 * It lives here rather than inline in `cleanup-old-parties/index.ts` for the
 * reason TEST_STRATEGY.md gives under "Extracting Logic to Make It Testable": the rule
 * was unreachable from any test, and the obstacle was the shape of the code
 * around it rather than the rule itself. MO-001 was marked "verified by
 * inspection" for exactly one line — the cutoff arithmetic — because asserting
 * it end-to-end would need a 72h-old party in CI. Asserting it *here* needs a
 * function call.
 *
 * Deno (the edge function) and Vitest (the unit tier) both import this file.
 * It therefore uses nothing but `Date`: no Deno globals, no Supabase client,
 * no imports at all. `_shared/` is deployed alongside the function by
 * `supabase functions deploy`, so this is the runtime's own copy, not a
 * transcription of it that could drift.
 *
 * Not covered by the mutation tier: `stryker.config.json` mutates `src/lib/**`
 * deliberately, mirroring the coverage surface in `vite.config.ts`, and this
 * is edge-function source rather than app source. Extending that glob would
 * make the coverage and mutation numbers stop describing the same code.
 */

/** MO-001: parties are retained for at most this many hours after creation. */
export const RETENTION_HOURS = 72;

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * The instant before which a party is past its retention window.
 *
 * Arithmetic on epoch milliseconds, not `Date.prototype.setHours`. The original
 * was `cutoff.setHours(cutoff.getHours() - 72)`, which subtracts 72 hours of
 * *local wall-clock time*. Under a timezone that observes DST those are not 72
 * elapsed hours: across a spring-forward the cutoff lands an hour late, across
 * a fall-back an hour early, and a party is deleted an hour early or kept an
 * hour long. Supabase's edge runtime is UTC, so the two agree in production and
 * this was never a live defect — but the correctness of MO-001 depended on the
 * deployment's timezone rather than on the rule, and that dependency was
 * invisible until the arithmetic could be asserted.
 */
export function retentionCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - RETENTION_HOURS * MS_PER_HOUR);
}

/**
 * Whether a party created at `createdAt` is past its retention window at `now`.
 *
 * The boundary is exclusive, matching the `.lt("created_at", cutoff)` query the
 * edge function issues: a party created at *exactly* the cutoff is retained.
 * Stating it here is what makes the query and the rule checkable against each
 * other — one of them can now be wrong in a way a test notices.
 */
export function isPastRetention(createdAt: Date | string, now: Date = new Date()): boolean {
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(created.getTime())) {
    throw new Error(`isPastRetention: unparseable created_at ${String(createdAt)}`);
  }
  return created.getTime() < retentionCutoff(now).getTime();
}
