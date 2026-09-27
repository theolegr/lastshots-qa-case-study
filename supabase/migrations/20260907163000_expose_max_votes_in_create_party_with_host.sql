-- `create_party_with_host` never returned `max_votes` either.
--
-- 20260901172918 fixed this exact hole in `get_party_by_code` and stopped
-- there. The sibling RPC has the same shape and the same defect: it builds its
-- response with an explicit `jsonb_build_object` key list, so a column added to
-- `parties` does not appear in it, and nothing warns you. `createParty` has
-- been handing back a party with no vote quota since `max_votes` was added on
-- 20260827124027.
--
-- Why this one never bit. The party is created in `status = 'waiting'` with the
-- default quota, and every consumer re-reads it through `get_party_by_code`
-- before the quota is ever used — `CreateParty.tsx` reads only `code`, `id` and
-- `name` off the response and navigates to the lobby, which refetches. So the
-- omission was latent where the `get_party_by_code` one was live. Latent is not
-- fixed: any future caller that trusts the returned party would get `undefined`
-- and, in `Vote.tsx`, silently fall back to `?? 5`.
--
-- Found by deriving the client's row types from the generated schema
-- (ROADMAP §3.6). The old code cast this response with
-- `data as unknown as { party: Party; participant: Participant }`, which
-- asserted a `max_votes` the payload never carried. `src/lib/dbContracts.ts`
-- now types it honestly as `CreatedParty = Omit<Party, "max_votes">` and
-- validates it at runtime, so the gap is visible in the type system rather
-- than in a bug report.
--
-- `CREATE OR REPLACE` is safe here, unlike 20260901172918. That migration had
-- to `DROP` first because changing a `RETURNS TABLE` column list changes the
-- function's OUT-parameter row type (SQLSTATE 42P13). This function returns a
-- scalar `jsonb`; only the value inside it changes, so the signature is
-- untouched.
--
-- Ordering note for whoever applies this. The client tolerates the new key
-- before and after: `parseCreatePartyPayload` uses a non-strict `z.object`,
-- which strips keys it does not know about. So this migration can land alone,
-- with no client change and no window in which the two disagree. Tightening
-- `CreatedParty` back to `Party` is a separate commit that must come *after*
-- this is applied — do it before, and every `createParty` call throws.

CREATE OR REPLACE FUNCTION public.create_party_with_host(_party_name text, _host_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _party_id           uuid;
  _code               varchar(6);
  _participant_id     uuid;
  _user_id            uuid;
  _party_record       jsonb;
  _participant_record jsonb;
  _avatar_emojis      text[] := ARRAY['😀','😎','🥳','🤩','😊','🤗','😜','🤓','🥸','😈','👻','🤖','👽','🦄','🐱','🐶'];
  _random_emoji       text;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _party_name IS NULL OR trim(_party_name) = '' THEN RAISE EXCEPTION 'Party name is required'; END IF;
  IF _host_name  IS NULL OR trim(_host_name)  = '' THEN RAISE EXCEPTION 'Host name is required';  END IF;

  LOOP
    _code := lpad(floor(random() * 1000000)::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM parties WHERE code = _code);
  END LOOP;

  _random_emoji := _avatar_emojis[1 + floor(random() * array_length(_avatar_emojis, 1))::int];

  INSERT INTO parties (code, name, host_name, status)
  VALUES (_code, trim(_party_name), trim(_host_name), 'waiting')
  RETURNING id INTO _party_id;

  INSERT INTO participants (party_id, name, user_id, is_host, avatar_emoji)
  VALUES (_party_id, trim(_host_name), _user_id, true, _random_emoji)
  RETURNING id INTO _participant_id;

  INSERT INTO situations (party_id, title, emoji, display_order) VALUES
    (_party_id, 'Someone making a weird face',      '🤪', 0),
    (_party_id, 'A group hug moment',               '🤗', 1),
    (_party_id, 'Someone caught dancing',           '💃', 2),
    (_party_id, 'The host being embarrassed',       '😳', 3),
    (_party_id, 'Best friendship pose',             '🤝', 4),
    (_party_id, 'Most dramatic expression',         '😱', 5),
    (_party_id, 'Caught eating something',          '🍕', 6),
    (_party_id, 'The sneaky photobomb',             '👀', 7),
    (_party_id, 'Someone pretending to be a DJ',   '🎧', 8),
    (_party_id, 'Someone hiding from the camera',  '🫣', 9),
    (_party_id, 'Caught mid-yawn',                 '🥱', 10),
    (_party_id, 'The "I swear I''m sober" pose',  '🥴', 11);

  -- `max_votes` is the line this migration exists for. Anyone adding a party
  -- setting must touch three places: the ALTER TABLE, this key list, and
  -- `get_party_by_code`'s RETURNS TABLE. Two of the three are silent when
  -- missed.
  SELECT jsonb_build_object(
    'id', p.id, 'code', p.code, 'name', p.name, 'host_name', p.host_name,
    'status', p.status, 'created_at', p.created_at, 'ends_at', p.ends_at,
    'voting_ends_at', p.voting_ends_at, 'capture_hours', p.capture_hours,
    'voting_hours', p.voting_hours, 'max_situations', p.max_situations,
    'max_votes', p.max_votes
  ) INTO _party_record FROM parties p WHERE p.id = _party_id;

  SELECT jsonb_build_object(
    'id', pt.id, 'party_id', pt.party_id, 'name', pt.name,
    'avatar_emoji', pt.avatar_emoji, 'is_host', pt.is_host,
    'joined_at', pt.joined_at, 'user_id', pt.user_id
  ) INTO _participant_record FROM participants pt WHERE pt.id = _participant_id;

  RETURN jsonb_build_object('party', _party_record, 'participant', _participant_record);
END;
$$;
