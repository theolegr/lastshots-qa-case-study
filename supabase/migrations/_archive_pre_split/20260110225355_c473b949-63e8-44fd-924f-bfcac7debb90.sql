-- First, delete any orphaned participant rows with null user_id
DELETE FROM public.participants WHERE user_id IS NULL;

-- Fix SELECT policy to allow users to see their own participant row immediately after insert
DROP POLICY IF EXISTS "View party participants" ON public.participants;

CREATE POLICY "View party participants"
ON public.participants
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_party_participant(party_id, auth.uid())
);

-- Ensure user_id is not nullable for security
ALTER TABLE public.participants
  ALTER COLUMN user_id SET NOT NULL;

-- Prevent duplicate participant entries per party
CREATE UNIQUE INDEX IF NOT EXISTS participants_party_user_unique
  ON public.participants(party_id, user_id);