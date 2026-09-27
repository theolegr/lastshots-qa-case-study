-- `situations.emoji` is deleted rather than repaired.
--
-- The defect (ROADMAP §3.4): two mechanisms create situations and only one sets
-- an emoji. `create_party_with_host` inserts 12 hard-coded rows with one each;
-- `sync_party_situations`, fired by the `reroll_situations_on_count_change`
-- trigger whenever `max_situations` changes, deletes rows at or past the new
-- target and tops the list back up from `situation_pool` — a table with no
-- emoji column. So lowering the count to 5 and raising it back to 10 refills
-- five rows with `emoji = NULL`, permanently. The delete is unconditional and
-- nothing re-derives them.
--
-- Two ways to close it. Repair: add an `emoji` column to `situation_pool` and
-- carry it through the top-up. Delete: remove the column. **Delete was chosen**
-- — nothing has ever rendered `situations.emoji`. It was written by the RPC,
-- typed in `api.ts`, carried through `getPartySituations`, and never displayed,
-- which is exactly why the defect went unreported for as long as it existed. A
-- column no code reads is not a feature with a bug in it; it is weight.
--
-- The consequence, stated plainly: the 12 hard-coded emoji leave the product.
-- If situations should show an emoji later, the honest implementation puts it
-- on `situation_pool` so both creation paths can carry it — which is the repair
-- option above, done properly rather than bolted onto a column only one path
-- ever filled.
--
-- Nothing in the client changes. `grep` finds no read of the field anywhere in
-- `src/` or `tests/`; the only two writes are in this function, and both go in
-- this migration. `Situation` derives from the generated schema
-- (`src/lib/dbContracts.ts`), so regenerating types after this is applied drops
-- the field from the type automatically — and because nothing reads it, that
-- regeneration cannot break a call site.
--
-- Order matters here: replace the function *before* dropping the column, or the
-- existing definition references a column that no longer exists. Both run in
-- the single transaction the migration is applied in.

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

  INSERT INTO situations (party_id, title, display_order) VALUES
    (_party_id, 'Someone making a weird face', 0),
    (_party_id, 'A group hug moment', 1),
    (_party_id, 'Someone caught dancing', 2),
    (_party_id, 'The host being embarrassed', 3),
    (_party_id, 'Best friendship pose', 4),
    (_party_id, 'Most dramatic expression', 5),
    (_party_id, 'Caught eating something', 6),
    (_party_id, 'The sneaky photobomb', 7),
    (_party_id, 'Someone pretending to be a DJ', 8),
    (_party_id, 'Someone hiding from the camera', 9),
    (_party_id, 'Caught mid-yawn', 10),
    (_party_id, 'The "I swear I''m sober" pose', 11);

  -- Unchanged from 20260907163000, `max_votes` included. This migration
  -- restates the whole function only because plpgsql has no way to alter one
  -- statement of a body.
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

-- The column itself. `DROP COLUMN` is irreversible in effect: the 12 emoji on
-- every existing party go with it. That is the decision, not an oversight —
-- nothing displays them, so nothing observable is lost.
ALTER TABLE public.situations DROP COLUMN emoji;
