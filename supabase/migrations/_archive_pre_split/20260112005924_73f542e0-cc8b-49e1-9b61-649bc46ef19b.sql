-- Drop the existing overly permissive policy
DROP POLICY IF EXISTS "Create party" ON public.parties;

-- Create new policy that requires authentication (works with anonymous auth)
CREATE POLICY "Create party"
ON public.parties
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);