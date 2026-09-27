// @covers none — `cn()` merges Tailwind classes; it encodes no product rule
import { describe, it, expect } from "vitest";
import type { ClassValue } from "clsx";
import { cn, MAX_PHOTO_SIZE, validatePhotoBlob } from "@/lib/utils";
import * as submissionRules from "@/lib/submissionRules";

// `cn` is a one-line wrapper over clsx + tailwind-merge, so these tests
// deliberately assert only the two behaviours the components depend on — that
// conflicting Tailwind classes resolve to the last one, and that falsy branches
// disappear. Anything more would be re-testing the libraries.

describe("cn", () => {
  it("keeps the last of two conflicting Tailwind utilities", () => {
    // The whole reason the app uses tailwind-merge rather than plain clsx: a
    // component's default class must lose to the one passed in by the caller.
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("drops falsy conditional classes", () => {
    // Spread rather than an inline `false && "hidden"`: the literal form is a
    // constant expression that lint (correctly) rejects, and the value under
    // test is the falsy input itself, not the short-circuit that produced it.
    const falsyBranches: ClassValue[] = [false, null, undefined, ""];
    expect(cn("base", ...falsyBranches)).toBe("base");
  });

  it("keeps non-conflicting classes in order", () => {
    expect(cn("flex", "items-center")).toBe("flex items-center");
  });

  it("accepts arrays and objects like clsx does", () => {
    expect(cn(["flex", "gap-2"], { hidden: false, "font-bold": true })).toBe(
      "flex gap-2 font-bold"
    );
  });

  it("resolves a conflict across argument forms, not just within one", () => {
    // `flex` and `block` are both `display` utilities, so the later one wins
    // even though they arrive via different argument shapes. Worth pinning:
    // a component passing `className="block"` to a `flex` container relies on
    // exactly this.
    expect(cn(["flex", "gap-2"], { block: true })).toBe("gap-2 block");
  });
});

// ─── Backwards-compatibility re-exports ──────────────────────────────────────

describe("utils re-exports", () => {
  it("re-exports the submission rules identically, not as copies", () => {
    // `utils.ts` re-exports these "for backwards compat" and `CaptureMode`
    // still imports `validatePhotoBlob` from here rather than from
    // `submissionRules`. Asserting identity means a future cleanup that drops
    // the indirection has to update the call sites rather than silently
    // leaving two diverging definitions.
    expect(validatePhotoBlob).toBe(submissionRules.validatePhotoBlob);
    expect(MAX_PHOTO_SIZE).toBe(submissionRules.MAX_PHOTO_SIZE);
  });
});
