/**
 * Berkeley CRM — Visits
 * CRUD for visit records.
 */

import { sb } from './supabase-client.js';

/* Fetch visits for a customer */
export async function fetchVisits(customerId) {
  const { data, error } = await sb
    .from('visits')
    .select('*')
    .eq('customer_id', customerId)
    .order('visited_at', { ascending: false });
  if (error) throw error;
  return data;
}

/* Fetch all visits (for dashboard stats) */
export async function fetchAllVisits(userId) {
  let query = sb.from('visits').select('*').order('visited_at', { ascending: false });
  if (userId && userId !== 'all') query = query.eq('user_id', userId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/* Register a visit */
export async function registerVisit(customerId, userId, comment, visitedAt, visitType, contactPerson) {
  const row = {
    customer_id: customerId,
    user_id: userId,
    visited_at: visitedAt || new Date().toISOString(),
    comment: comment || null
  };
  if (visitType) row.visit_type = visitType;
  if (contactPerson) row.contact_person = contactPerson;
  const { data, error } = await sb
    .from('visits')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/* Update a visit */
export async function updateVisit(id, fields) {
  const { data, error } = await sb
    .from('visits')
    .update(fields)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/* Delete a visit */
export async function deleteVisit(id) {
  const { error } = await sb.from('visits').delete().eq('id', id);
  if (error) throw error;
}

/* Get last visit date for a customer */
export async function getLastVisit(customerId) {
  const { data, error } = await sb
    .from('visits')
    .select('visited_at')
    .eq('customer_id', customerId)
    .order('visited_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? new Date(data.visited_at) : null;
}
