-- ═══════════════════════════════════════════════════════════════
-- Berkeley CRM v6 — Richer visit data
-- Run in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS visit_type TEXT DEFAULT 'physical';
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS contact_person TEXT DEFAULT '';
