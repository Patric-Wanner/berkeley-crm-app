-- ═══════════════════════════════════════════════════════════════
-- Berkeley CRM v5 — Extra customer fields
-- Run in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS email TEXT DEFAULT '';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS website TEXT DEFAULT '';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS org_nr TEXT DEFAULT '';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';
