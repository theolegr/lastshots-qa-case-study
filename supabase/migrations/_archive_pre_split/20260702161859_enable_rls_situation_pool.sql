-- Fixes Supabase security advisory: rls_disabled_in_public on public.situation_pool
-- situation_pool holds the master list of challenge prompts that sync_party_situations()
-- and the reroll_situations_on_count_change trigger draw from. Both are SECURITY DEFINER,
-- so they bypass RLS regardless of policies. No frontend code queries this table directly
-- (confirmed via grep), so enabling RLS with zero policies fully closes anon/authenticated
-- read+write access without breaking any existing read path.
ALTER TABLE public.situation_pool ENABLE ROW LEVEL SECURITY;
