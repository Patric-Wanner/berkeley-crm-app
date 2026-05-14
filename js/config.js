/**
 * Berkeley CRM — Configuration
 * Supabase credentials and app constants.
 *
 * The anon key is safe to expose — Row Level Security
 * enforces all access rules server-side.
 *
 * TODO: Replace with your actual Supabase project values.
 */

export const SUPABASE_URL  = 'https://ippgjswlbmypzzhqqksv.supabase.co';
export const SUPABASE_ANON = 'sb_publishable_9cVNdllw3Hor5-q76FHIMw_1v_iRQuR';

/* Map defaults */
export const MAP_CENTER = [57.8, 13.5];
export const MAP_ZOOM   = 7;

/* Berkeley HQ (fallback for route start) */
export const HQ = { lat: 57.6679522, lng: 12.0164957 };

/* OSRM */
export const OSRM_BASE = 'https://router.project-osrm.org';
