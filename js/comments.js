/**
 * Berkeley CRM — Comments
 */

import { sb } from './supabase-client.js';

export async function fetchComments(customerId) {
  const { data, error } = await sb
    .from('comments')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function addComment(customerId, userId, text) {
  const { data, error } = await sb
    .from('comments')
    .insert({ customer_id: customerId, user_id: userId, text })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteComment(id) {
  const { error } = await sb.from('comments').delete().eq('id', id);
  if (error) throw error;
}
