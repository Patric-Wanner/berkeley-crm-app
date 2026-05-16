-- ═══════════════════════════════════════════════════════════════
-- Berkeley CRM v4 — Monthly revenue granularity
-- Run in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- Add month column (1-12, NULL = full year entry)
ALTER TABLE public.revenue ADD COLUMN IF NOT EXISTS month INTEGER;

-- Drop old unique constraint and add new one
ALTER TABLE public.revenue DROP CONSTRAINT IF EXISTS revenue_customer_id_year_key;
ALTER TABLE public.revenue ADD CONSTRAINT revenue_customer_year_month_key UNIQUE (customer_id, year, month);
