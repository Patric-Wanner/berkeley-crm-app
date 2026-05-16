/**
 * Berkeley CRM — Revenue
 */

import { sb } from './supabase-client.js';

export async function fetchRevenue(customerId) {
  const { data, error } = await sb
    .from('revenue')
    .select('*')
    .eq('customer_id', customerId)
    .order('year', { ascending: false })
    .order('month', { ascending: true, nullsFirst: true });
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

export async function upsertRevenue(customerId, year, amount, month = null) {
  const row = { customer_id: customerId, year, amount };
  if (month) row.month = month;
  const { data, error } = await sb
    .from('revenue')
    .upsert(row, { onConflict: 'customer_id,year,month' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteRevenue(id) {
  const { error } = await sb.from('revenue').delete().eq('id', id);
  if (error) throw error;
}
