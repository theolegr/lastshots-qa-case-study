-- Enable full row data for realtime updates on parties
ALTER TABLE public.parties REPLICA IDENTITY FULL;

-- Add parties table to realtime publication (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND schemaname = 'public' 
    AND tablename = 'parties'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.parties;
  END IF;
END $$;