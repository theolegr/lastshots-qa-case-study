-- Create a secure function to lookup party by code (for joining)
-- This allows users to find a party by code without seeing all parties
CREATE OR REPLACE FUNCTION public.get_party_by_code(_code varchar)
RETURNS TABLE (
  id uuid,
  code varchar,
  name text,
  host_name text,
  status text,
  created_at timestamptz,
  ends_at timestamptz,
  voting_ends_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, code, name, host_name, status, created_at, ends_at, voting_ends_at
  FROM public.parties
  WHERE parties.code = _code
  LIMIT 1
$$;

-- Drop the existing overly permissive policy
DROP POLICY IF EXISTS "View parties" ON public.parties;

-- Create a restrictive policy: only participants can see party details
CREATE POLICY "View parties as participant" 
ON public.parties 
FOR SELECT 
USING (is_party_participant(id, auth.uid()));