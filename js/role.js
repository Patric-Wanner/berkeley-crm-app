/**
 * Berkeley CRM — Role
 * Fetch and cache the current user's profile and role.
 * Roles: salesperson < manager < admin
 */

import { sb } from './supabase-client.js';

let _profile = null;

const LEVELS = { salesperson: 1, manager: 2, admin: 3 };

/* Fetch profile from DB (called once at app start) */
export async function loadProfile(userId) {
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) throw error;
  _profile = data;
  return _profile;
}

/* Get cached profile */
export function getProfile() {
  return _profile;
}

/* Get role string */
export function getRole() {
  return _profile?.role || 'salesperson';
}

/* Check if current user has at least this role level */
export function hasRole(minimum) {
  return (LEVELS[getRole()] || 0) >= (LEVELS[minimum] || 0);
}

/* Get all salespeople (for manager/admin filters) */
export async function fetchAllProfiles() {
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .order('display_name');
  if (error) throw error;
  return data;
}
