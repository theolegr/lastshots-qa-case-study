-- Add user_id column to participants table
ALTER TABLE public.participants 
ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- Create helper function to check party membership
CREATE OR REPLACE FUNCTION public.is_party_participant(
  _party_id uuid,
  _user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.participants
    WHERE party_id = _party_id AND user_id = _user_id
  )
$$;

-- Create helper function to check if user is host of a party
CREATE OR REPLACE FUNCTION public.is_party_host(
  _party_id uuid,
  _user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.participants
    WHERE party_id = _party_id AND user_id = _user_id AND is_host = true
  )
$$;

-- Drop existing policies
DROP POLICY IF EXISTS "Anyone can view parties" ON public.parties;
DROP POLICY IF EXISTS "Anyone can create a party" ON public.parties;
DROP POLICY IF EXISTS "Anyone can update party status" ON public.parties;

DROP POLICY IF EXISTS "Anyone can view participants" ON public.participants;
DROP POLICY IF EXISTS "Anyone can join a party" ON public.participants;

DROP POLICY IF EXISTS "Anyone can view situations" ON public.situations;
DROP POLICY IF EXISTS "Anyone can create situations" ON public.situations;

DROP POLICY IF EXISTS "Anyone can view photos" ON public.photos;
DROP POLICY IF EXISTS "Anyone can upload photos" ON public.photos;

DROP POLICY IF EXISTS "Anyone can view votes" ON public.votes;
DROP POLICY IF EXISTS "Anyone can vote" ON public.votes;
DROP POLICY IF EXISTS "Anyone can remove their vote" ON public.votes;

-- PARTIES policies
-- Allow viewing parties by code (for joining)
CREATE POLICY "View parties" ON public.parties 
FOR SELECT TO authenticated
USING (true);

-- Allow authenticated users to create parties
CREATE POLICY "Create party" ON public.parties 
FOR INSERT TO authenticated
WITH CHECK (true);

-- Only host can update party
CREATE POLICY "Host can update party" ON public.parties 
FOR UPDATE TO authenticated
USING (public.is_party_host(id, auth.uid()));

-- PARTICIPANTS policies
-- View participants if user is in the same party
CREATE POLICY "View party participants" ON public.participants 
FOR SELECT TO authenticated
USING (public.is_party_participant(party_id, auth.uid()));

-- Allow joining (inserting) with own user_id
CREATE POLICY "Join party" ON public.participants 
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

-- SITUATIONS policies
-- View situations if user is participant
CREATE POLICY "View party situations" ON public.situations 
FOR SELECT TO authenticated
USING (public.is_party_participant(party_id, auth.uid()));

-- Allow creating situations (for party creation)
CREATE POLICY "Create situations" ON public.situations 
FOR INSERT TO authenticated
WITH CHECK (true);

-- PHOTOS policies
-- View photos if user is participant
CREATE POLICY "View party photos" ON public.photos 
FOR SELECT TO authenticated
USING (public.is_party_participant(party_id, auth.uid()));

-- Upload photos if user is participant
CREATE POLICY "Upload party photos" ON public.photos 
FOR INSERT TO authenticated
WITH CHECK (public.is_party_participant(party_id, auth.uid()));

-- VOTES policies
-- View votes if user is participant of the photo's party
CREATE POLICY "View party votes" ON public.votes 
FOR SELECT TO authenticated
USING (
  photo_id IN (
    SELECT id FROM public.photos 
    WHERE public.is_party_participant(party_id, auth.uid())
  )
);

-- Vote if user is participant and voting for own voter_id
CREATE POLICY "Cast vote" ON public.votes 
FOR INSERT TO authenticated
WITH CHECK (
  voter_id IN (
    SELECT id FROM public.participants WHERE user_id = auth.uid()
  )
  AND photo_id IN (
    SELECT p.id FROM public.photos p
    JOIN public.participants part ON part.party_id = p.party_id
    WHERE part.user_id = auth.uid()
  )
);

-- Remove own vote
CREATE POLICY "Remove own vote" ON public.votes 
FOR DELETE TO authenticated
USING (
  voter_id IN (
    SELECT id FROM public.participants WHERE user_id = auth.uid()
  )
);

-- Update storage bucket to private
UPDATE storage.buckets SET public = false WHERE id = 'party-photos';

-- Drop existing storage policies
DROP POLICY IF EXISTS "Anyone can upload photos" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view photos" ON storage.objects;

-- Create new storage policies for authenticated party participants
CREATE POLICY "Party participants can upload photos" ON storage.objects 
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'party-photos' AND
  (storage.foldername(name))[1]::uuid IN (
    SELECT party_id FROM public.participants WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Party participants can view photos" ON storage.objects 
FOR SELECT TO authenticated
USING (
  bucket_id = 'party-photos' AND
  (storage.foldername(name))[1]::uuid IN (
    SELECT party_id FROM public.participants WHERE user_id = auth.uid()
  )
);