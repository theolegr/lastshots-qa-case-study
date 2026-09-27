-- `get_party_by_code` never returned `max_votes`, so the setting was stored and
-- never read.
--
-- The RPC declares an explicit RETURNS TABLE column list. Adding a column to
-- `parties` does not widen it, and nothing warns you: the client receives a
-- party object without the field, `Vote.tsx` falls back to `?? 5`, and a host
-- who picked 7 or 10 silently gets 5. The migration that added the column
-- (20260827124027) shipped a setting that could not reach the UI.
--
-- Two things made this invisible for a full CI cycle. `vote-cap.spec.ts` is the
-- only test that drives the quota through the real page, and it is not in the
-- `@smoke` tier, so local smoke runs stayed green. And `api.ts` casts the RPC
-- result with `as Party` — an unchecked cast over an interface that declares
-- `max_votes: number` — so the missing field was not a type error either.
--
-- Same shape as `situations.emoji` (ROADMAP §3.4 / §3.1): a hand-written type
-- asserting a field the data does not carry, laundered through `as`.
--
-- DROP then CREATE, not CREATE OR REPLACE. Postgres refuses to replace a
-- function whose OUT-parameter row type changes (SQLSTATE 42P13), and adding a
-- column to RETURNS TABLE is exactly that. Both statements run inside the one
-- transaction the migration is applied in, so the function is never observably
-- absent. No GRANT is restated because none was ever granted explicitly: the
-- function relies on Postgres' default EXECUTE-to-PUBLIC, which the new
-- definition receives the same way the old one did.
--
-- The wider lesson for anyone adding a settings column: `parties` is read
-- through this RPC on every join path, so a column added to the table is not
-- reachable by the app until it is added here too.

DROP FUNCTION IF EXISTS public.get_party_by_code(varchar);

CREATE FUNCTION public.get_party_by_code(_code varchar)
RETURNS TABLE (
  id uuid, code varchar, name text, host_name text, status text,
  created_at timestamptz, ends_at timestamptz, voting_ends_at timestamptz,
  capture_hours numeric, voting_hours numeric, max_situations integer,
  max_votes integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, code, name, host_name, status, created_at, ends_at, voting_ends_at,
         capture_hours, voting_hours, max_situations, max_votes
  FROM public.parties WHERE parties.code = _code LIMIT 1
$$;
