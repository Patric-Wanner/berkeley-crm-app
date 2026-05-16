-- ═══════════════════════════════════════════════════════════════
-- Berkeley CRM v3 — Customer todos + activity support
-- Run in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.customer_todos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  done        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_todos_customer ON public.customer_todos(customer_id);

ALTER TABLE public.customer_todos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "todos_select" ON public.customer_todos
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_id
      AND (c.assigned_to = auth.uid() OR public.get_my_role() IN ('manager', 'admin'))
    )
  );

CREATE POLICY "todos_insert" ON public.customer_todos
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "todos_update" ON public.customer_todos
  FOR UPDATE USING (user_id = auth.uid() OR public.get_my_role() = 'admin');

CREATE POLICY "todos_delete" ON public.customer_todos
  FOR DELETE USING (user_id = auth.uid() OR public.get_my_role() = 'admin');
