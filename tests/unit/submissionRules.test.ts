// @covers PS-003, PS-004, PS-006
import { describe, it, expect } from "vitest";
import {
  validatePhotoBlob,
  hasRemainingShots,
  canSubmitToSituation,
  canSubmitPhoto,
  MAX_PHOTO_SIZE,
  MAX_SHOTS,
} from "@/lib/submissionRules";

// ─── validatePhotoBlob ───────────────────────────────────────────────────────

describe("validatePhotoBlob", () => {
  it("returns null for a blob under the size limit", () => {
    const blob = new Blob(["x".repeat(100)], { type: "image/jpeg" });
    expect(validatePhotoBlob(blob)).toBeNull();
  });

  it("returns null for a blob exactly at the size limit", () => {
    const blob = new Blob([new ArrayBuffer(MAX_PHOTO_SIZE)], { type: "image/jpeg" });
    expect(validatePhotoBlob(blob)).toBeNull();
  });

  it("returns 'too_large' for a blob over the size limit", () => {
    const blob = new Blob([new ArrayBuffer(MAX_PHOTO_SIZE + 1)], { type: "image/jpeg" });
    expect(validatePhotoBlob(blob)).toBe("too_large");
  });

  it("returns null for an empty blob", () => {
    const blob = new Blob([], { type: "image/jpeg" });
    expect(validatePhotoBlob(blob)).toBeNull();
  });
});

// ─── hasRemainingShots ───────────────────────────────────────────────────────

describe("hasRemainingShots", () => {
  it("returns true when no shots have been used", () => {
    expect(hasRemainingShots(0)).toBe(true);
  });

  it("returns true when shots used is below the limit", () => {
    expect(hasRemainingShots(3)).toBe(true);
  });

  it("returns false when shots used equals the limit", () => {
    expect(hasRemainingShots(MAX_SHOTS)).toBe(false);
  });

  it("returns false when shots used exceeds the limit", () => {
    expect(hasRemainingShots(MAX_SHOTS + 1)).toBe(false);
  });

  it("respects a custom maxShots value", () => {
    expect(hasRemainingShots(2, 3)).toBe(true);
    expect(hasRemainingShots(3, 3)).toBe(false);
  });
});

// ─── canSubmitToSituation ────────────────────────────────────────────────────

describe("canSubmitToSituation", () => {
  it("returns true when situation is not in completed list", () => {
    expect(canSubmitToSituation("sit-3", ["sit-1", "sit-2"])).toBe(true);
  });

  it("returns false when situation is already completed", () => {
    expect(canSubmitToSituation("sit-1", ["sit-1", "sit-2"])).toBe(false);
  });

  it("returns true when completed list is empty", () => {
    expect(canSubmitToSituation("sit-1", [])).toBe(true);
  });
});

// ─── canSubmitPhoto (combined gate) ──────────────────────────────────────────

describe("canSubmitPhoto", () => {
  it("returns true when shots remain and situation is not completed", () => {
    expect(canSubmitPhoto("sit-3", ["sit-1"], 2)).toBe(true);
  });

  it("returns false when no shots remain", () => {
    expect(canSubmitPhoto("sit-3", ["sit-1"], MAX_SHOTS)).toBe(false);
  });

  it("returns false when situation is already completed", () => {
    expect(canSubmitPhoto("sit-1", ["sit-1"], 2)).toBe(false);
  });

  it("returns false when both conditions fail", () => {
    expect(canSubmitPhoto("sit-1", ["sit-1"], MAX_SHOTS)).toBe(false);
  });
});
