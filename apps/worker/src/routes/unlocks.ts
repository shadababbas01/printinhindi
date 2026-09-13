import type { Env } from '../index';
import { requireUser, isResponse } from '../middleware/auth';
import { serviceClient } from '../services/supabase';
import { computeEntitlement, type PlanRow } from '../services/entitlement';
import { decideUnlock, unlockValidUntil } from '../services/credits';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function loadEntitlement(env: Env, userId: string) {
  const db = serviceClient(env);
  const now = new Date();
  const [{ data: plansRows }, { data: subs }, { data: purchases }, { data: overrides }, { data: trial }, { data: wallet }] =
    await Promise.all([
      db.from('plans').select('id, unlimited_documents, device_limit, validity_days'),
      db.from('subscriptions').select('plan_id, status, current_period_end').eq('user_id', userId),
      db.from('purchases').select('plan_id, status, paid_at').eq('user_id', userId).eq('status', 'PAID'),
      db.from('entitlement_overrides').select('plan_id, active_from, active_until').eq('user_id', userId),
      db.from('trials').select('*').eq('user_id', userId).maybeSingle(),
      db.from('credit_wallets').select('balance').eq('user_id', userId).maybeSingle(),
    ]);
  const plans: Record<string, PlanRow & { validity_days?: number }> = {};
  for (const p of plansRows ?? []) plans[p.id] = p as any;
  return computeEntitlement({
    now,
    plans,
    subscriptions: subs ?? [],
    purchases: purchases ?? [],
    overrides: overrides ?? [],
    trial: trial ?? null,
    creditBalance: wallet?.balance ?? 0,
    deviceCount: 0,
  });
}

// `clientUnlockKey` is a random opaque id generated in the browser per
// document-editing session — NOT derived from the document's content or
// filename, so nothing document-identifying ever reaches the server.
export async function handleCreateUnlock(env: Env, request: Request): Promise<Response> {
  const user = await requireUser(env, request);
  if (isResponse(user)) return user;

  const body = (await request.json().catch(() => null)) as { clientUnlockKey?: string } | null;
  if (!body?.clientUnlockKey) return json({ error: 'INVALID_BODY' }, 400);

  const db = serviceClient(env);
  const now = new Date();

  const { data: existing } = await db
    .from('document_unlocks')
    .select('id, client_unlock_key, valid_until')
    .eq('user_id', user.id)
    .eq('client_unlock_key', body.clientUnlockKey)
    .order('unlocked_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const entitlement = await loadEntitlement(env, user.id);
  const decision = decideUnlock({
    now,
    clientUnlockKey: body.clientUnlockKey,
    existingUnlock: existing ?? null,
    entitlement,
  });

  if (!decision.allowed) return json({ error: decision.reason }, 402);

  if (decision.source === 'existing_unlock') {
    return json({ allowed: true, unlockId: decision.unlockId, validUntil: existing!.valid_until });
  }

  const validUntil = unlockValidUntil(now);
  const { data: inserted, error } = await db
    .from('document_unlocks')
    .insert({
      user_id: user.id,
      client_unlock_key: body.clientUnlockKey,
      source: decision.source === 'trial' ? 'trial' : decision.source === 'flex_credit' ? 'flex_credit' : 'trial',
      valid_until: validUntil.toISOString(),
    })
    .select('id')
    .single();
  if (error || !inserted) return json({ error: 'UNLOCK_RECORD_FAILED' }, 500);

  if ('consumesTrialUnlock' in decision) {
    const { error: rpcErr } = await db.rpc('increment_trial_unlocks', { p_user_id: user.id });
    if (rpcErr) {
      // Fallback if the RPC helper isn't installed yet: read-modify-write
      // (acceptable low-contention risk for a single-user trial counter).
      const { data: t } = await db.from('trials').select('trial_unlocks_used').eq('user_id', user.id).maybeSingle();
      await db
        .from('trials')
        .update({ trial_unlocks_used: (t?.trial_unlocks_used ?? 0) + 1 })
        .eq('user_id', user.id);
    }
  } else if ('consumesCredit' in decision) {
    await db.from('credit_transactions').insert({
      user_id: user.id,
      delta: -1,
      reason: 'document_unlock',
      unlock_id: inserted.id,
    });
    const { error: rpcErr } = await db.rpc('decrement_wallet_balance', { p_user_id: user.id, p_amount: 1 });
    if (rpcErr) {
      const { data: w } = await db.from('credit_wallets').select('balance').eq('user_id', user.id).maybeSingle();
      await db
        .from('credit_wallets')
        .update({ balance: Math.max(0, (w?.balance ?? 0) - 1) })
        .eq('user_id', user.id);
    }
  }

  return json({ allowed: true, unlockId: inserted.id, validUntil: validUntil.toISOString() });
}

export async function handleGetUnlock(env: Env, request: Request, unlockKey: string): Promise<Response> {
  const user = await requireUser(env, request);
  if (isResponse(user)) return user;
  const db = serviceClient(env);
  const { data } = await db
    .from('document_unlocks')
    .select('id, valid_until, unlocked_at')
    .eq('user_id', user.id)
    .eq('client_unlock_key', unlockKey)
    .order('unlocked_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return json({ unlock: data ?? null });
}
