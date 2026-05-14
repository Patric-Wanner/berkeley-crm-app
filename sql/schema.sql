-- ═══════════════════════════════════════════════════════════════
-- Berkeley CRM v2 — Supabase Schema
-- Run this in Supabase SQL Editor (Settings → SQL Editor)
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Profiles table ────────────────────────────────────────

CREATE TABLE public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  role        TEXT NOT NULL DEFAULT 'salesperson'
              CHECK (role IN ('salesperson', 'manager', 'admin')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. Helper function (must exist before RLS policies) ──────

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

-- ── 3. Profiles RLS ─────────────────────────────────────────

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (true);

CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE USING (
    id = auth.uid()
    OR public.get_my_role() = 'admin'
  );

CREATE POLICY "profiles_insert" ON public.profiles
  FOR INSERT WITH CHECK (public.get_my_role() = 'admin');

CREATE POLICY "profiles_delete" ON public.profiles
  FOR DELETE USING (public.get_my_role() = 'admin');

-- ── 4. Auto-create profile on signup ─────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    'salesperson'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── 5. Customers ─────────────────────────────────────────────

CREATE TABLE public.customers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_nr TEXT NOT NULL DEFAULT '',
  name        TEXT NOT NULL,
  address     TEXT DEFAULT '',
  zip         TEXT DEFAULT '',
  city        TEXT NOT NULL DEFAULT '',
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'inactive', 'prospect')),
  assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_customers_assigned ON public.customers(assigned_to);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customers_select" ON public.customers
  FOR SELECT USING (
    assigned_to = auth.uid()
    OR public.get_my_role() IN ('manager', 'admin')
  );

CREATE POLICY "customers_insert" ON public.customers
  FOR INSERT WITH CHECK (
    assigned_to = auth.uid()
    OR public.get_my_role() = 'admin'
  );

CREATE POLICY "customers_update" ON public.customers
  FOR UPDATE USING (
    assigned_to = auth.uid()
    OR public.get_my_role() = 'admin'
  );

CREATE POLICY "customers_delete" ON public.customers
  FOR DELETE USING (public.get_my_role() = 'admin');

-- ── 6. Contacts (per customer) ───────────────────────────────

CREATE TABLE public.contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  person_name TEXT NOT NULL DEFAULT '',
  phone       TEXT DEFAULT '',
  email       TEXT DEFAULT '',
  is_primary  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_contacts_customer ON public.contacts(customer_id);

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contacts_select" ON public.contacts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_id
      AND (c.assigned_to = auth.uid() OR public.get_my_role() IN ('manager', 'admin'))
    )
  );

CREATE POLICY "contacts_insert" ON public.contacts
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_id
      AND (c.assigned_to = auth.uid() OR public.get_my_role() = 'admin')
    )
  );

CREATE POLICY "contacts_update" ON public.contacts
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_id
      AND (c.assigned_to = auth.uid() OR public.get_my_role() = 'admin')
    )
  );

CREATE POLICY "contacts_delete" ON public.contacts
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_id
      AND (c.assigned_to = auth.uid() OR public.get_my_role() = 'admin')
    )
  );

-- ── 7. Visits ────────────────────────────────────────────────

CREATE TABLE public.visits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  visited_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  comment     TEXT DEFAULT ''
);

CREATE INDEX idx_visits_customer ON public.visits(customer_id);
CREATE INDEX idx_visits_user     ON public.visits(user_id);

ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "visits_select" ON public.visits
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.get_my_role() IN ('manager', 'admin')
  );

CREATE POLICY "visits_insert" ON public.visits
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    OR public.get_my_role() = 'admin'
  );

CREATE POLICY "visits_delete" ON public.visits
  FOR DELETE USING (
    user_id = auth.uid()
    OR public.get_my_role() = 'admin'
  );

-- ── 8. Comments ──────────────────────────────────────────────

CREATE TABLE public.comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_comments_customer ON public.comments(customer_id);

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comments_select" ON public.comments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_id
      AND (c.assigned_to = auth.uid() OR public.get_my_role() IN ('manager', 'admin'))
    )
  );

CREATE POLICY "comments_insert" ON public.comments
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
  );

CREATE POLICY "comments_delete" ON public.comments
  FOR DELETE USING (
    user_id = auth.uid()
    OR public.get_my_role() = 'admin'
  );

-- ── 9. Revenue ───────────────────────────────────────────────

CREATE TABLE public.revenue (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  year        INTEGER NOT NULL,
  amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(customer_id, year)
);

CREATE INDEX idx_revenue_customer ON public.revenue(customer_id);

ALTER TABLE public.revenue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "revenue_select" ON public.revenue
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_id
      AND (c.assigned_to = auth.uid() OR public.get_my_role() IN ('manager', 'admin'))
    )
  );

CREATE POLICY "revenue_upsert" ON public.revenue
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_id
      AND (c.assigned_to = auth.uid() OR public.get_my_role() = 'admin')
    )
  );

CREATE POLICY "revenue_update" ON public.revenue
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_id
      AND (c.assigned_to = auth.uid() OR public.get_my_role() = 'admin')
    )
  );

CREATE POLICY "revenue_delete" ON public.revenue
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_id
      AND (c.assigned_to = auth.uid() OR public.get_my_role() = 'admin')
    )
  );

-- ── 10. Next Visits (scheduled) ──────────────────────────────

CREATE TABLE public.next_visits (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    UUID NOT NULL UNIQUE REFERENCES public.customers(id) ON DELETE CASCADE,
  scheduled_date DATE NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.next_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "next_visits_select" ON public.next_visits
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_id
      AND (c.assigned_to = auth.uid() OR public.get_my_role() IN ('manager', 'admin'))
    )
  );

CREATE POLICY "next_visits_insert" ON public.next_visits
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_id
      AND (c.assigned_to = auth.uid() OR public.get_my_role() = 'admin')
    )
  );

CREATE POLICY "next_visits_update" ON public.next_visits
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_id
      AND (c.assigned_to = auth.uid() OR public.get_my_role() = 'admin')
    )
  );

CREATE POLICY "next_visits_delete" ON public.next_visits
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_id
      AND (c.assigned_to = auth.uid() OR public.get_my_role() = 'admin')
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- Done! Now create users via Supabase Auth dashboard.
-- The trigger auto-creates a profile row for each new user.
-- Then update roles:
--   UPDATE profiles SET role = 'admin' WHERE email = 'patric@...';
--   UPDATE profiles SET role = 'manager' WHERE email = 'chef@...';
-- ═══════════════════════════════════════════════════════════════
