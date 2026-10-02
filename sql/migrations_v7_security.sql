-- ═══════════════════════════════════════════════════════════════
-- Berkeley CRM v7 — Security fixes
-- Run in Supabase SQL Editor (after v6). Safe to re-run.
-- Only policies, functions and triggers change — no rows are
-- touched.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Pin search_path on SECURITY DEFINER functions ─────────

ALTER FUNCTION public.get_my_role() SET search_path = public;
ALTER FUNCTION public.handle_new_user() SET search_path = public;

-- handle_new_user is only meant to run as the signup trigger, not
-- via the API. get_my_role keeps EXECUTE: every RLS policy calls it.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- ── 2. Profiles: readable by logged-in users only ────────────
-- Was USING (true) for everyone, so the public anon key could
-- list every user's email and role.

DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT TO authenticated USING (true);

-- ── 3. Only admins may change roles ──────────────────────────
-- profiles_update lets users edit their own row, which let a
-- salesperson set role = 'admin' on themselves. SQL Editor and
-- service role (auth.uid() IS NULL) are still allowed.

CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND public.get_my_role() IS DISTINCT FROM 'admin'
     AND (NEW.role IS DISTINCT FROM OLD.role OR NEW.id IS DISTINCT FROM OLD.id) THEN
    RAISE EXCEPTION 'Endast admin kan ändra roller';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_role ON public.profiles;
CREATE TRIGGER protect_profile_role
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_role();

-- ── 4. Inserts require access to the customer ────────────────
-- Comments, todos and visits could be added to any customer id.
-- Now: only customers you can see (own, or all for manager/admin).

DROP POLICY IF EXISTS "comments_insert" ON public.comments;
CREATE POLICY "comments_insert" ON public.comments
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_id
      AND (c.assigned_to = auth.uid() OR public.get_my_role() IN ('manager', 'admin'))
    )
  );

DROP POLICY IF EXISTS "todos_insert" ON public.customer_todos;
CREATE POLICY "todos_insert" ON public.customer_todos
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_id
      AND (c.assigned_to = auth.uid() OR public.get_my_role() IN ('manager', 'admin'))
    )
  );

DROP POLICY IF EXISTS "visits_insert" ON public.visits;
CREATE POLICY "visits_insert" ON public.visits
  FOR INSERT WITH CHECK (
    (user_id = auth.uid() OR public.get_my_role() = 'admin')
    AND EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_id
      AND (c.assigned_to = auth.uid() OR public.get_my_role() IN ('manager', 'admin'))
    )
  );

-- ── 5. Visits: missing UPDATE policy ─────────────────────────
-- Editing a visit comment (updateVisit) always failed.

DROP POLICY IF EXISTS "visits_update" ON public.visits;
CREATE POLICY "visits_update" ON public.visits
  FOR UPDATE USING (
    user_id = auth.uid()
    OR public.get_my_role() = 'admin'
  );

COMMIT;

-- ── Check: list all policies ─────────────────────────────────
-- Look for extra policies not created by schema.sql/migrations —
-- permissive policies are OR'ed, so a stray one re-opens access.

SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd, policyname;
