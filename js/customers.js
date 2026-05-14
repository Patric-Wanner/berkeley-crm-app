/**
 * Berkeley CRM — Customers
 * CRUD operations for customers table.
 * RLS handles salesperson filtering automatically.
 */

import { sb } from './supabase-client.js';

/* Fetch all customers visible to current user */
export async function fetchCustomers(assignedTo) {
  let query = sb.from('customers').select('*').order('name');
  if (assignedTo && assignedTo !== 'all') {
    query = query.eq('assigned_to', assignedTo);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/* Get single customer */
export async function getCustomer(id) {
  const { data, error } = await sb
    .from('customers')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

/* Create a new customer */
export async function createCustomer(customer) {
  const { data, error } = await sb
    .from('customers')
    .insert(customer)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/* Update customer fields */
export async function updateCustomer(id, updates) {
  const { data, error } = await sb
    .from('customers')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/* Delete customer (admin only) */
export async function deleteCustomer(id) {
  const { error } = await sb.from('customers').delete().eq('id', id);
  if (error) throw error;
}

/* Reassign customer to another salesperson (admin only) */
export async function reassignCustomer(id, newUserId) {
  return updateCustomer(id, { assigned_to: newUserId });
}

/* Bulk reassign */
export async function reassignCustomers(ids, newUserId) {
  const { error } = await sb
    .from('customers')
    .update({ assigned_to: newUserId, updated_at: new Date().toISOString() })
    .in('id', ids);
  if (error) throw error;
}
