-- Drop the existing overly permissive policy
DROP POLICY IF EXISTS "Create situations" ON public.situations;

-- Create new policy that only allows hosts to create situations
CREATE POLICY "Create situations"
ON public.situations
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_party_host(party_id, auth.uid())
);