-- ═══════════════════════════════════════════════════════════════
-- Berkeley CRM v2 — Migrations
-- Run these AFTER the initial schema.sql
-- ═══════════════════════════════════════════════════════════════

-- Add updated_at to customers (if not exists)
ALTER TABLE public.customers
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Add role column to contacts (if not exists)
ALTER TABLE public.contacts
ADD COLUMN IF NOT EXISTS role TEXT DEFAULT '';

-- Activity log for audit trail
CREATE TABLE IF NOT EXISTS public.activity_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,           -- 'visit', 'customer_created', 'customer_updated', 'comment', 'revenue', etc.
  entity_type TEXT NOT NULL DEFAULT '', -- 'customer', 'visit', 'contact', 'comment', 'revenue'
  entity_id   UUID,
  customer_id UUID REFERENCES public.customers(id) ON DELETE CASCADE,
  details     JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_customer ON public.activity_log(customer_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_user ON public.activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_created ON public.activity_log(created_at DESC);

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activity_log_select" ON public.activity_log
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.get_my_role() IN ('manager', 'admin')
  );

CREATE POLICY "activity_log_insert" ON public.activity_log
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════
-- Done! Run this in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════
