// Pure party creation/join validation logic — no database, no side effects.

import { z } from "zod";

export const PartySchema = z.object({
  name: z.string().trim().min(1, "Party name is required").max(100, "Party name must be less than 100 characters"),
  hostName: z.string().trim().min(1, "Host name is required").max(50, "Host name must be less than 50 characters"),
});

export const JoinSchema = z.object({
  name: z.string().trim().min(1, "Username is required").max(50, "Username must be less than 50 characters"),
  code: z.string().regex(/^\d{6}$/, "Party code must be exactly 6 digits"),
});

export type PartyInput = z.infer<typeof PartySchema>;
export type JoinInput = z.infer<typeof JoinSchema>;

/** Validates party creation input. Returns the trimmed values or throws ZodError. */
export function validatePartyInput(name: string, hostName: string): PartyInput {
  return PartySchema.parse({ name, hostName });
}

/** Validates join input. Returns the trimmed values or throws ZodError. */
export function validateJoinInput(code: string, name: string): JoinInput {
  return JoinSchema.parse({ name, code });
}

/** Party code format check (pure, no DB lookup). */
export function isValidPartyCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}
