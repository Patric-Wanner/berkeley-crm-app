/**
 * Berkeley CRM — Revenue
 */

import { sb } from './supabase-client.js';

export async function fetchRevenue(customerId) {
  const { data, error } = await sb
    .from('revenue')
    .select('*')
    .eq('customer_id', customerId)
    .order('year', { ascending: false });
  if (error) throw error;
  return data;
}

export async function fetchAllRevenue() {
  const { data, error } = await sb
    .from('revenue')
    .select('*, customers!inner(assigned_to)')
    .order('year', { ascending: false });
  if (error) throw error;
  return data;
}

export async function upsertRevenue(customerId, year, amount) {
  const { data, error } = await sb
    .from('revenue')
    .upsert({ customer_id: customerId, year, amount }, { onConflict: 'customer_id,year' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteRevenue(id) {
  const { error } = await sb.from('revenue').delete().eq('id', id);
  if (error) throw error;
}
