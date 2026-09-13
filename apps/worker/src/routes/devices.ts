import type { Env } from '../index';
import { requireUser, isResponse } from '../middleware/auth';
import { serviceClient } from '../services/supabase';
import { decideDeviceRegistration } from '../services/devices';
import { computeEntitlement, type PlanRow } from '../services/entitlement';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function currentDeviceLimit(env: Env, userId: string): Promise<number> {
  const db = serviceClient(env);
  const now = new Date();
  const [{ data: plansRows }, { data: subs }, { data: purchases }, { data: overrides }, { data: wallet }] =
    await Promise.all([
      db.from('plans').select('id, unlimited_documents, device_limit, validity_days'),
      db.from('subscriptions').select('plan_id, status, current_period_end').eq('user_id', userId),
      db.from('purchases').select('plan_id, status, paid_at').eq('user_id', userId).eq('status', 'PAID'),
      db.from('entitlement_overrides').select('plan_id, active_from, active_until').eq('user_id', userId),
      db.from('credit_wallets').select('balance').eq('user_id', userId).maybeSingle(),
    ]);
  const plans: Record<string, PlanRow & { validity_days?: number }> = {};
  for (const p of plansRows ?? []) plans[p.id] = p as any;
  const entitlement = computeEntitlement({
    now,
    plans,
    subscriptions: subs ?? [],
    purchases: purchases ?? [],
    overrides: overrides ?? [],
    creditBalance: wallet?.balance ?? 0,
    deviceCount: 0,
  });
  return entitlement.deviceLimit;
}

export async function handleRegisterDevice(env: Env, request: Request): Promise<Response> {
  const user = await requireUser(env, request);
  if (isResponse(user)) return user;

  const body = (await request.json().catch(() => null)) as { installationId?: string; displayName?: string } | null;
  if (!body?.installationId) return json({ error: 'INVALID_BODY' }, 400);

  const db = serviceClient(env);
  const { data: devices } = await db.from('devices').select('installation_id, revoked_at').eq('user_id', user.id);
  const deviceLimit = await currentDeviceLimit(env, user.id);

  const decision = decideDeviceRegistration(body.installationId, devices ?? [], deviceLimit);
  if (!decision.allowed) return json(decision, 409);

  const { error } = await db.from('devices').upsert(
    {
      user_id: user.id,
      installation_id: body.installationId,
      display_name: body.displayName ?? null,
      user_agent: request.headers.get('User-Agent') ?? null,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,installation_id' }
  );
  if (error) return json({ error: 'DEVICE_REGISTER_FAILED' }, 500);

  return json({ allowed: true });
}

export async function handleListDevices(env: Env, request: Request): Promise<Response> {
  const user = await requireUser(env, request);
  if (isResponse(user)) return user;
  const db = serviceClient(env);
  const { data } = await db.from('devices').select('*').eq('user_id', user.id).order('last_seen_at', { ascending: false });
  return json({ devices: data ?? [] });
}

export async function handleDeleteDevice(env: Env, request: Request, deviceId: string): Promise<Response> {
  const user = await requireUser(env, request);
  if (isResponse(user)) return user;
  const db = serviceClient(env);
  const { error } = await db
    .from('devices')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', deviceId)
    .eq('user_id', user.id); // scope to owner — never let a user revoke someone else's device
  if (error) return json({ error: 'DEVICE_REVOKE_FAILED' }, 500);
  return json({ ok: true });
}
