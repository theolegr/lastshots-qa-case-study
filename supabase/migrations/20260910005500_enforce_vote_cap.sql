-- The vote quota becomes a rule the database enforces (VT-002, ROADMAP §3.2).
--
-- `parties.max_votes` has been the authoritative source of the quota since
-- `20260827124027`, but only the client read it. Three things guarded `votes`:
-- `UNIQUE(photo_id, voter_id)` against a repeat vote on one photo, the
-- `Cast vote` policy against a non-member, a self-vote or a closed window —
-- and nothing at all against the count. A crafted client casting one vote per
-- photo across distinct photos was inside every rule the schema actually had,
-- which `vote-cap-server-side.spec.ts` demonstrated rather than asserted.
--
-- Not a CHECK constraint: the count spans rows and the limit lives on another
-- table. Not an extension of the `Cast vote` policy either, though a `WITH
-- CHECK` sub-select could count — a policy answers "may you vote at all?", and
-- reads under the caller's own RLS, so a later change to `View party votes`
-- would silently shrink the count to zero and un-enforce the cap with every
-- test still green. The count has to be authoritative, so it is SECURITY
-- DEFINER, and it belongs beside the rule it enforces.

-- The count filters on `voter_id`; the only index that mentions the column is
-- `UNIQUE(photo_id, voter_id)`, whose leading column is the wrong one. Without
-- this the trigger scans `votes` on every insert.
CREATE INDEX IF NOT EXISTS idx_votes_voter_id ON public.votes(voter_id);

CREATE OR REPLACE FUNCTION public.enforce_vote_quota()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _party_id  uuid;
  _max_votes integer;
  _cast      integer;
BEGIN
  SELECT pa.id, pa.max_votes INTO _party_id, _max_votes
  FROM participants pt
  JOIN parties pa ON pa.id = pt.party_id
  WHERE pt.id = NEW.voter_id;

  -- The FK on `voter_id` makes this unreachable; a trigger that decides who may
  -- write is the wrong place to assume its inputs exist.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vote refers to a participant that does not exist'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Two inserts on distinct photos, arriving together, would otherwise both
  -- read a count below the quota and both be allowed — the cap would hold for
  -- an ordinary client and leak by one for a parallel one. The lock is per
  -- voter and released at commit, so it serialises a single player's votes and
  -- nothing else.
  PERFORM pg_advisory_xact_lock(hashtext('votes_quota'), hashtext(NEW.voter_id::text));

  -- Scoped to the party rather than trusting that a participant belongs to
  -- exactly one — which is true, and enforced elsewhere, and not this
  -- function's to assume.
  SELECT count(*) INTO _cast
  FROM votes v
  JOIN photos ph ON ph.id = v.photo_id
  WHERE v.voter_id = NEW.voter_id
    AND ph.party_id = _party_id;

  IF _cast >= _max_votes THEN
    RAISE EXCEPTION 'Vote quota exhausted: % of % votes already cast', _cast, _max_votes
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_vote_quota
  BEFORE INSERT ON public.votes
  FOR EACH ROW
  EXECUTE FUNCTION enforce_vote_quota();
