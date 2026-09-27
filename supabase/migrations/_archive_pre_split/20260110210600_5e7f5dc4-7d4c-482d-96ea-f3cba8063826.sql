-- Create votes table for storing participant votes
CREATE TABLE public.votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  voter_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (photo_id, voter_id)
);

-- Enable RLS
ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can view votes"
ON public.votes
FOR SELECT
USING (true);

CREATE POLICY "Anyone can vote"
ON public.votes
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Anyone can remove their vote"
ON public.votes
FOR DELETE
USING (true);

-- Add voting_ends_at column to parties table
ALTER TABLE public.parties ADD COLUMN voting_ends_at timestamptz;