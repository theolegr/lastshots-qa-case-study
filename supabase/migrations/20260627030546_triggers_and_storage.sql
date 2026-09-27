
CREATE OR REPLACE FUNCTION public.sync_party_situations(_party_id uuid, _target int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _current int;
  _need    int;
BEGIN
  DELETE FROM situations WHERE party_id = _party_id AND display_order >= _target;
  SELECT count(*) INTO _current FROM situations WHERE party_id = _party_id;
  _need := _target - _current;
  IF _need > 0 THEN
    INSERT INTO situations (party_id, title, display_order)
    SELECT _party_id, sp.text, _current + (row_number() OVER ()) - 1
    FROM (
      SELECT text FROM situation_pool
      WHERE is_active AND text NOT IN (SELECT title FROM situations WHERE party_id = _party_id)
      ORDER BY random()
      LIMIT _need
    ) sp;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reroll_situations_on_count_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.sync_party_situations(NEW.id, NEW.max_situations);
  RETURN NEW;
END;
$$;

CREATE TRIGGER reroll_situations_on_count_change
  AFTER UPDATE OF max_situations ON public.parties
  FOR EACH ROW
  WHEN (NEW.max_situations IS DISTINCT FROM OLD.max_situations)
  EXECUTE FUNCTION reroll_situations_on_count_change();

CREATE OR REPLACE FUNCTION public.enforce_party_settings_locked()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'waiting' AND (
       NEW.capture_hours  IS DISTINCT FROM OLD.capture_hours
    OR NEW.voting_hours   IS DISTINCT FROM OLD.voting_hours
    OR NEW.max_situations IS DISTINCT FROM OLD.max_situations
  ) THEN
    RAISE EXCEPTION 'Party settings cannot change once status leaves waiting'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER party_settings_locked
  BEFORE UPDATE ON public.parties
  FOR EACH ROW
  EXECUTE FUNCTION enforce_party_settings_locked();

INSERT INTO storage.buckets (id, name, public) VALUES ('party-photos', 'party-photos', false);

CREATE POLICY "Party participants can upload photos" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'party-photos'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT party_id FROM public.participants WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Party participants can view photos" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'party-photos'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT party_id FROM public.participants WHERE user_id = auth.uid()
    )
  );
;
