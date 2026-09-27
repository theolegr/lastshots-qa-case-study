
CREATE OR REPLACE FUNCTION public.is_party_participant(_party_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.participants WHERE party_id = _party_id AND user_id = _user_id)
$$;

CREATE OR REPLACE FUNCTION public.is_party_host(_party_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.participants WHERE party_id = _party_id AND user_id = _user_id AND is_host = true)
$$;

CREATE POLICY "Create party" ON public.parties FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "View parties as participant" ON public.parties FOR SELECT USING (is_party_participant(id, auth.uid()));
CREATE POLICY "Host can update party" ON public.parties FOR UPDATE USING (is_party_host(id, auth.uid()));

CREATE POLICY "View party participants" ON public.participants FOR SELECT
  USING (user_id = auth.uid() OR is_party_participant(party_id, auth.uid()));
CREATE POLICY "Join party" ON public.participants FOR INSERT
  WITH CHECK (user_id = auth.uid() AND is_host = false);

CREATE POLICY "View party situations" ON public.situations FOR SELECT
  USING (is_party_participant(party_id, auth.uid()));
CREATE POLICY "Create situations" ON public.situations FOR INSERT
  WITH CHECK (is_party_host(party_id, auth.uid()));

CREATE POLICY "Upload party photos" ON public.photos FOR INSERT
  WITH CHECK (
    is_party_participant(party_id, auth.uid())
    AND participant_id IN (SELECT id FROM public.participants WHERE user_id = auth.uid())
  );
CREATE POLICY "View party photos" ON public.photos FOR SELECT
  USING (
    is_party_participant(party_id, auth.uid())
    AND (
      participant_id IN (SELECT id FROM public.participants WHERE user_id = auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.parties p
        WHERE p.id = photos.party_id AND p.ends_at IS NOT NULL AND p.ends_at <= now()
      )
    )
  );

CREATE POLICY "View party votes" ON public.votes FOR SELECT
  USING (photo_id IN (SELECT id FROM public.photos WHERE is_party_participant(party_id, auth.uid())));
CREATE POLICY "Cast vote" ON public.votes FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.photos ph
      JOIN public.parties pa ON pa.id = ph.party_id
      JOIN public.participants voter ON voter.id = votes.voter_id
      WHERE ph.id = votes.photo_id
        AND voter.user_id = auth.uid()
        AND voter.party_id = ph.party_id
        AND ph.participant_id <> voter.id
        AND pa.voting_ends_at IS NOT NULL
        AND pa.voting_ends_at > now()
    )
  );
CREATE POLICY "Remove own vote" ON public.votes FOR DELETE
  USING (voter_id IN (SELECT id FROM public.participants WHERE user_id = auth.uid()));
;
