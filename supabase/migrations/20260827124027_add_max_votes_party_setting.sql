-- The vote quota becomes a party setting, decided by the host at creation.
--
-- Until now the cap lived only as `const MAX_VOTES = 5` in Vote.tsx. Two
-- problems: the number was unenforced anywhere (ROADMAP §3.2), and it did not
-- scale with `max_situations`, which the host *can* set to 5 / 7 / 10. A host
-- who picked 10 situations still got 5 votes.
--
-- This migration adds the setting. It does NOT yet enforce the cap server-side
-- — that stays §3.2 — but it gives the rule a single authoritative source in
-- the database to be enforced *from*, which is what was missing.
--
-- `max_votes` may deliberately exceed `max_situations`: several votes inside one
-- situation is a legitimate configuration, so no cross-column CHECK is added.
-- The bound is only that a quota must be positive.

ALTER TABLE public.parties
  ADD COLUMN max_votes INTEGER NOT NULL DEFAULT 5
  CONSTRAINT parties_max_votes_positive CHECK (max_votes > 0);

-- The lock trigger enumerates settings columns explicitly, so a new column is
-- NOT covered by it automatically. Without this replacement `max_votes` would
-- stay mutable for the whole party while the other three settings freeze the
-- moment status leaves 'waiting' — a silent asymmetry no existing test would
-- catch, because settings-immutable.spec.ts asserts the UI is unreachable
-- rather than that the database refuses the write.
CREATE OR REPLACE FUNCTION public.enforce_party_settings_locked()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'waiting' AND (
       NEW.capture_hours  IS DISTINCT FROM OLD.capture_hours
    OR NEW.voting_hours   IS DISTINCT FROM OLD.voting_hours
    OR NEW.max_situations IS DISTINCT FROM OLD.max_situations
    OR NEW.max_votes      IS DISTINCT FROM OLD.max_votes
  ) THEN
    RAISE EXCEPTION 'Party settings cannot change once status leaves waiting'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
