/**
 * Berkeley CRM — Auth
 * Login, logout, session guard.
 */

import { sb } from './supabase-client.js';

/* Check if user is logged in — redirect to login if not */
export async function requireAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  return session;
}

/* Login with email + password */
export async function login(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

/* Logout */
export async function logout() {
  await sb.auth.signOut();
  window.location.href = 'index.html';
}

/* Listen for auth state changes (token refresh, etc.) */
export function onAuthChange(callback) {
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || (!session && event === 'TOKEN_REFRESHED')) {
      window.location.href = 'index.html';
    }
    if (callback) callback(event, session);
  });
}
