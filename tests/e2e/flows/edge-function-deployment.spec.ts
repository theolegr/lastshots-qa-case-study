// @covers MO-001
// @regression BUG-003
// Flow — every edge function in the repo is actually deployed
//
// Regression guard for BUG-003. `cleanup-old-parties` existed in the repo,
// was correct, and was covered by MO-001 "verified by inspection" — but it was
// never deployed to lastshots-web after the 2026-06-26 project split. Retention
// silently stopped for five weeks and no test noticed, because every other test
// asserts application behaviour and none assert that infrastructure exists.
//
// The expected set is read from supabase/functions/ rather than hardcoded, so a
// newly added function is probed automatically instead of being forgotten here.
//
// Uses OPTIONS deliberately. cleanup-old-parties returns early on OPTIONS
// (index.ts:10-12); every other method deletes storage objects, votes, photos,
// situations, participants and parties. A GET here would wipe live data.
//
// Cost: 0 anonymous sign-ins — unauthenticated probes against the functions
// gateway. Deployment state is a property of the project, not of any session.

import "dotenv/config";
import { test, expect } from "../fixtures/test";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const FUNCTIONS_DIR = join(process.cwd(), "supabase", "functions");

function expectedFunctions(): string[] {
  if (!existsSync(FUNCTIONS_DIR)) return [];
  return readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
    .map((e) => e.name);
}

test.describe("Flow — edge function deployment", { tag: "@smoke" }, () => {
  test("every function in supabase/functions is reachable on this project", async () => {
    const functions = expectedFunctions();
    expect(functions.length, "no edge functions found on disk — check the path").toBeGreaterThan(0);

    const missing: string[] = [];
    for (const slug of functions) {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/${slug}`, { method: "OPTIONS" });
      if (res.status === 404) missing.push(slug);
    }

    expect(
      missing,
      `Declared in supabase/functions/ but not deployed to ${SUPABASE_URL}: ${missing.join(", ")}. ` +
        `Deploy with: npx supabase functions deploy <slug> --project-ref <ref>`
    ).toEqual([]);
  });

  test("an unknown function slug still 404s — proves the probe discriminates", async () => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/does-not-exist-control-probe`, {
      method: "OPTIONS",
    });
    expect(res.status).toBe(404);
  });
});
