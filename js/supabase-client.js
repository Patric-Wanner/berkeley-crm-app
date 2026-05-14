/**
 * Berkeley CRM — Supabase Client
 * Singleton Supabase instance used by all modules.
 */

import { SUPABASE_URL, SUPABASE_ANON } from './config.js';

const { createClient } = supabase; // loaded via CDN in HTML
export const sb = createClient(SUPABASE_URL, SUPABASE_ANON);
