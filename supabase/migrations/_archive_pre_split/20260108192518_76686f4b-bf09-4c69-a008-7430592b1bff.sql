-- Table des parties
CREATE TABLE public.parties (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code VARCHAR(6) NOT NULL UNIQUE,
  name TEXT NOT NULL,
  host_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'playing', 'ended')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  ends_at TIMESTAMP WITH TIME ZONE
);

-- Table des participants
CREATE TABLE public.participants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  party_id UUID NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  avatar_emoji TEXT NOT NULL DEFAULT '😀',
  is_host BOOLEAN NOT NULL DEFAULT false,
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table des situations (défis photo)
CREATE TABLE public.situations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  party_id UUID NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  emoji TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0
);

-- Table des photos capturées
CREATE TABLE public.photos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  party_id UUID NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  situation_id UUID NOT NULL REFERENCES public.situations(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  captured_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.situations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photos ENABLE ROW LEVEL SECURITY;

-- Policies pour parties (accès public en lecture via code, création libre)
CREATE POLICY "Anyone can create a party" ON public.parties FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can view parties" ON public.parties FOR SELECT USING (true);
CREATE POLICY "Anyone can update party status" ON public.parties FOR UPDATE USING (true);

-- Policies pour participants
CREATE POLICY "Anyone can join a party" ON public.participants FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can view participants" ON public.participants FOR SELECT USING (true);

-- Policies pour situations
CREATE POLICY "Anyone can create situations" ON public.situations FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can view situations" ON public.situations FOR SELECT USING (true);

-- Policies pour photos
CREATE POLICY "Anyone can upload photos" ON public.photos FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can view photos" ON public.photos FOR SELECT USING (true);

-- Enable realtime for lobby updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.participants;

-- Create storage bucket for photos
INSERT INTO storage.buckets (id, name, public) VALUES ('party-photos', 'party-photos', true);

-- Storage policies
CREATE POLICY "Anyone can upload photos" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'party-photos');
CREATE POLICY "Anyone can view photos" ON storage.objects FOR SELECT USING (bucket_id = 'party-photos');