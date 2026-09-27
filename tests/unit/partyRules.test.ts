// @covers MB-005, MB-007, PM-005
import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import {
  validatePartyInput,
  validateJoinInput,
  isValidPartyCode,
} from "@/lib/partyRules";

/**
 * The messages a rejected input actually produced.
 *
 * Added 2026-09-01 after mutation testing: `.toThrow()` with no argument passes
 * on *any* throw, so blanking every validation message in `partyRules.ts` left
 * all these tests green — 7 of the 13 surviving mutants were exactly that
 * (the mutation baseline is in `TEST_RESULTS.md`). Guiding Rule 2 in `TEST_STRATEGY.md` exists because BUG-002 shipped a
 * misleading error: blocking worked, the diagnosis lied. A unit tier that
 * asserts *that* validation failed and never *what it said* cannot see that
 * class of defect at all.
 *
 * Reading `issues` rather than matching on `error.message` keeps the assertion
 * on the message a user is shown, not on ZodError's JSON envelope.
 */
function rejectionMessages(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof ZodError) return error.issues.map((i) => i.message);
    throw error;
  }
  throw new Error("expected the input to be rejected, but it was accepted");
}

// ─── validatePartyInput ──────────────────────────────────────────────────────

describe("validatePartyInput", () => {
  it("accepts valid party name and host name", () => {
    const result = validatePartyInput("Friday Night", "Alice");
    expect(result.name).toBe("Friday Night");
    expect(result.hostName).toBe("Alice");
  });

  it("trims whitespace from both fields", () => {
    const result = validatePartyInput("  Party  ", "  Bob  ");
    expect(result.name).toBe("Party");
    expect(result.hostName).toBe("Bob");
  });

  it("rejects empty party name, naming the field", () => {
    expect(rejectionMessages(() => validatePartyInput("", "Alice"))).toContain(
      "Party name is required"
    );
  });

  it("rejects whitespace-only party name (trimmed to empty)", () => {
    expect(() => validatePartyInput("   ", "Alice")).toThrow();
  });

  it("rejects empty host name, naming the field", () => {
    expect(rejectionMessages(() => validatePartyInput("Party", ""))).toContain(
      "Host name is required"
    );
  });

  it("rejects whitespace-only host name (trimmed to empty)", () => {
    expect(() => validatePartyInput("Party", "   ")).toThrow();
  });

  it("accepts party name of exactly 100 characters", () => {
    const name = "a".repeat(100);
    expect(() => validatePartyInput(name, "Host")).not.toThrow();
  });

  it("rejects party name over 100 characters, naming the limit", () => {
    const name = "a".repeat(101);
    expect(rejectionMessages(() => validatePartyInput(name, "Host"))).toContain(
      "Party name must be less than 100 characters"
    );
  });

  it("accepts host name of exactly 50 characters", () => {
    const hostName = "b".repeat(50);
    expect(() => validatePartyInput("Party", hostName)).not.toThrow();
  });

  it("rejects host name over 50 characters, naming the limit", () => {
    const hostName = "b".repeat(51);
    expect(rejectionMessages(() => validatePartyInput("Party", hostName))).toContain(
      "Host name must be less than 50 characters"
    );
  });

  it("accepts single-character name and host after trim", () => {
    const result = validatePartyInput("X", "Y");
    expect(result.name).toBe("X");
    expect(result.hostName).toBe("Y");
  });
});

// ─── validateJoinInput ───────────────────────────────────────────────────────

describe("validateJoinInput", () => {
  it("accepts a valid 6-digit code and username", () => {
    const result = validateJoinInput("123456", "Charlie");
    expect(result.code).toBe("123456");
    expect(result.name).toBe("Charlie");
  });

  it("trims whitespace from the username", () => {
    const result = validateJoinInput("123456", "  Charlie  ");
    expect(result.name).toBe("Charlie");
  });

  it("rejects empty username, naming the field", () => {
    expect(rejectionMessages(() => validateJoinInput("123456", ""))).toContain(
      "Username is required"
    );
  });

  it("rejects whitespace-only username", () => {
    expect(() => validateJoinInput("123456", "   ")).toThrow();
  });

  it("rejects username over 50 characters, naming the limit", () => {
    expect(rejectionMessages(() => validateJoinInput("123456", "c".repeat(51)))).toContain(
      "Username must be less than 50 characters"
    );
  });

  it("rejects a 5-digit code, naming the expected format", () => {
    expect(rejectionMessages(() => validateJoinInput("12345", "Charlie"))).toContain(
      "Party code must be exactly 6 digits"
    );
  });

  it("rejects a 7-digit code", () => {
    expect(() => validateJoinInput("1234567", "Charlie")).toThrow();
  });

  it("rejects a code with letters", () => {
    expect(() => validateJoinInput("12ab56", "Charlie")).toThrow();
  });

  it("rejects an empty code", () => {
    expect(() => validateJoinInput("", "Charlie")).toThrow();
  });

  it("rejects a code with spaces", () => {
    expect(() => validateJoinInput("123 56", "Charlie")).toThrow();
  });

  it("accepts code 000000 (all zeros is valid)", () => {
    expect(() => validateJoinInput("000000", "Charlie")).not.toThrow();
  });
});

// ─── isValidPartyCode ────────────────────────────────────────────────────────

describe("isValidPartyCode", () => {
  it("returns true for a 6-digit string", () => {
    expect(isValidPartyCode("482910")).toBe(true);
  });

  it("returns false for 5 digits", () => {
    expect(isValidPartyCode("48291")).toBe(false);
  });

  it("returns false for 7 digits", () => {
    expect(isValidPartyCode("4829100")).toBe(false);
  });

  it("returns false for letters mixed in", () => {
    expect(isValidPartyCode("48a910")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isValidPartyCode("")).toBe(false);
  });

  it("returns false for a code with a leading space", () => {
    expect(isValidPartyCode(" 482910")).toBe(false);
  });
});
