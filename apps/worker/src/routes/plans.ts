import type { Env } from '../index';
import { serviceClient } from '../services/supabase';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Public route (no auth) — the pricing page needs this before login.
export async function handlePlans(env: Env): Promise<Response> {
  const db = serviceClient(env);
  const { data, error } = await db
    .from('plans')
    .select('id, name, description, amount_paise, currency, billing_type, billing_interval, validity_days, included_credits, unlimited_documents, device_limit, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) return json({ error: 'PLANS_FETCH_FAILED' }, 500);
  return json({ plans: data });
}
