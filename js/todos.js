/**
 * Berkeley CRM — Customer Todos
 * Per-customer action items / notes.
 */

import { sb } from './supabase-client.js';

export async function fetchTodos(customerId) {
  const { data, error } = await sb
    .from('customer_todos')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function addTodo(customerId, userId, text) {
  const { data, error } = await sb
    .from('customer_todos')
    .insert({ customer_id: customerId, user_id: userId, text })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function toggleTodo(id, done) {
  const { error } = await sb
    .from('customer_todos')
    .update({ done })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteTodo(id) {
  const { error } = await sb.from('customer_todos').delete().eq('id', id);
  if (error) throw error;
}
