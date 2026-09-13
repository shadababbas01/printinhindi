import type { Env } from '../index';
import { requireUser, isResponse } from '../middleware/auth';
import { serviceClient } from '../services/supabase';
import { computeEntitlement, type PlanRow } from '../services/entitlement';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Shared by the user-facing /entitlement route and the admin lookup route —
// one code path computes "what can this user do" regardless of who's asking.
export async function loadEntitlement(env: Env, userId: string) {
  const db = serviceClient(env);
  const now = new Date();

  const [{ data: plansRows }, { data: subs }, { data: purchases }, { data: overrides }, { data: trial }, { data: wallet }, { data: devices }] =
    await Promise.all([
      db.from('plans').select('id, unlimited_documents, device_limit, validity_days'),
      db.from('subscriptions').select('plan_id, status, current_period_end').eq('user_id', userId),
      db.from('purchases').select('plan_id, status, paid_at').eq('user_id', userId).eq('status', 'PAID'),
      db.from('entitlement_overrides').select('plan_id, active_from, active_until').eq('user_id', userId),
      db.from('trials').select('*').eq('user_id', userId).maybeSingle(),
      db.from('credit_wallets').select('balance').eq('user_id', userId).maybeSingle(),
      db.from('devices').select('installation_id, revoked_at').eq('user_id', userId),
    ]);

  const plans: Record<string, PlanRow & { validity_days?: number }> = {};
  for (const p of plansRows ?? []) plans[p.id] = p as any;

  const entitlement = computeEntitlement({
    now,
    plans,
    subscriptions: subs ?? [],
    purchases: purchases ?? [],
    overrides: overrides ?? [],
    trial: trial ?? null,
    creditBalance: wallet?.balance ?? 0,
    deviceCount: (devices ?? []).filter((d) => !d.revoked_at).length,
  });

  return { ...entitlement, userId, serverTime: now.toISOString() };
}

export async function handleEntitlement(env: Env, request: Request): Promise<Response> {
  const user = await requireUser(env, request);
  if (isResponse(user)) return user;
  return json(await loadEntitlement(env, user.id));
}
