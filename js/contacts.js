/**
 * Berkeley CRM — Contacts
 */

import { sb } from './supabase-client.js';

export async function fetchContacts(customerId) {
  const { data, error } = await sb
    .from('contacts')
    .select('*')
    .eq('customer_id', customerId)
    .order('is_primary', { ascending: false });
  if (error) throw error;
  return data;
}

export async function addContact(customerId, contact) {
  const { data, error } = await sb
    .from('contacts')
    .insert({ customer_id: customerId, ...contact })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateContact(id, updates) {
  const { data, error } = await sb
    .from('contacts')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteContact(id) {
  const { error } = await sb.from('contacts').delete().eq('id', id);
  if (error) throw error;
}

export async function setPrimaryContact(customerId, contactId) {
  /* Unset all, then set the one */
  await sb.from('contacts').update({ is_primary: false }).eq('customer_id', customerId);
  await sb.from('contacts').update({ is_primary: true }).eq('id', contactId);
}
