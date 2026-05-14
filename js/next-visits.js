/**
 * Berkeley CRM — Next Visits (scheduled visits)
 */

import { sb } from './supabase-client.js';

export async function fetchNextVisits() {
  const { data, error } = await sb
    .from('next_visits')
    .select('*, customers!inner(name, city, assigned_to)')
    .order('scheduled_date');
  if (error) throw error;
  return data;
}

export async function setNextVisit(customerId, date) {
  if (!date) {
    /* Remove */
    await sb.from('next_visits').delete().eq('customer_id', customerId);
    return;
  }
  const { data, error } = await sb
    .from('next_visits')
    .upsert({ customer_id: customerId, scheduled_date: date }, { onConflict: 'customer_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeNextVisit(customerId) {
  const { error } = await sb.from('next_visits').delete().eq('customer_id', customerId);
  if (error) throw error;
}
