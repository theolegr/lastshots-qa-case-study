
CREATE TABLE public.parties (
  id             UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code           VARCHAR(6) NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  host_name      TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'playing', 'ended')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at        TIMESTAMPTZ,
  voting_ends_at TIMESTAMPTZ,
  capture_hours  NUMERIC NOT NULL DEFAULT 12,
  voting_hours   NUMERIC NOT NULL DEFAULT 2,
  max_situations INTEGER NOT NULL DEFAULT 5
);

CREATE TABLE public.participants (
  id           UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  party_id     UUID NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  avatar_emoji TEXT NOT NULL DEFAULT '😀',
  is_host      BOOLEAN NOT NULL DEFAULT false,
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (party_id, user_id)
);

CREATE TABLE public.situations (
  id            UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  party_id      UUID NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  emoji         TEXT,
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE public.photos (
  id             UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  party_id       UUID NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  situation_id   UUID NOT NULL REFERENCES public.situations(id) ON DELETE CASCADE,
  image_url      TEXT NOT NULL,
  captured_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.votes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id   UUID NOT NULL REFERENCES public.photos(id) ON DELETE CASCADE,
  voter_id   UUID NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (photo_id, voter_id)
);

CREATE TABLE public.situation_pool (
  id         UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  text       TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.situation_pool (text) VALUES
  ('Most dramatic expression'), ('Caught off guard'), ('Worst shoes, great person'),
  ('The most photogenic disaster'), ('Best friendship pose'), ('Someone making a weird face'),
  ('The sneaky photobomb'), ('Someone who peaked tonight'), ('Caught mid-yawn'),
  ('Someone caught dancing'), ('Caught eating something'), ('A "Will they...?" moment'),
  ('The accidental model shot'), ('Recreate a movie poster'), ('A group hug moment'),
  ('The accidental photobomb'), ('Caught doing the move'), ('The "I swear I''m sober" pose'),
  ('Your best album-cover pose'), ('Just Keep Livin'''), ('The "main character" shot'),
  ('The "one more drink" face'), ('Best candid laugh'), ('The host being embarrassed'),
  ('Best fit of the night'), ('Someone playing air DJ'), ('The 3am snack situation'),
  ('The co-host nobody asked for'), ('The "it''s getting late" face'), ('Hiding from the camera');

ALTER TABLE public.parties      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.situations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votes        ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.parties REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.participants;
ALTER PUBLICATION supabase_realtime ADD TABLE public.parties;
;
