import type { Env } from '../index';
import { requireUser, isResponse, isAdmin, type AuthedUser } from '../middleware/auth';
import { serviceClient } from '../services/supabase';
import { planGrantMechanism } from '../services/grants';
import { loadEntitlement } from './entitlements';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Every admin route must call this first. Reuses the same JWT verification as
// normal routes, then additionally requires the caller's email to be on
// ADMIN_EMAIL_ALLOWLIST (middleware/auth.ts::isAdmin) — deny by default.
async function requireAdmin(env: Env, request: Request): Promise<AuthedUser | Response> {
  const user = await requireUser(env, request);
  if (isResponse(user)) return user;
  if (!isAdmin(env, user)) return json({ error: 'FORBIDDEN' }, 403);
  return user;
}

// Applies the actual entitlement effect for an approved manual payment / a
// direct admin grant. Mirrors the two mutation shapes the webhook handler
// already uses (credit_transactions+wallet, or a validity window) so there is
// no separate/parallel entitlement-granting code path to keep in sync.
async function applyGrant(
  env: Env,
  db: ReturnType<typeof serviceClient>,
  params: { userId: string; planId: string; reason: string; adminId: string; purchaseId?: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: plan } = await db.from('plans').select('*').eq('id', params.planId).maybeSingle();
  if (!plan) return { ok: false, error: 'UNKNOWN_PLAN' };

  const mechanism = planGrantMechanism(plan);
  const now = new Date();

  if (mechanism.kind === 'credits') {
    if (params.purchaseId) {
      const { data: existingGrant } = await db
        .from('credit_transactions')
        .select('id')
        .eq('purchase_id', params.purchaseId)
        .eq('reason', params.reason)
        .maybeSingle();
      if (existingGrant) return { ok: true }; // already granted — idempotent re-approval
    }
    await db.from('credit_transactions').insert({
      user_id: params.userId,
      delta: mechanism.credits,
      reason: params.reason,
      purchase_id: params.purchaseId ?? null,
      expires_at: new Date(now.getTime() + mechanism.validityDays * 86400000).toISOString(),
    });
    const { error } = await db.rpc('increment_wallet_balance', { p_user_id: params.userId, p_amount: mechanism.credits });
    if (error) return { ok: false, error: 'CREDIT_GRANT_FAILED' };
    return { ok: true };
  }

  if (mechanism.kind === 'override') {
    const activeUntil = new Date(now.getTime() + mechanism.validityDays * 86400000).toISOString();
    const { error } = await db.from('entitlement_overrides').insert({
      user_id: params.userId,
      plan_id: plan.id,
      active_from: now.toISOString(),
      active_until: activeUntil,
      reason: params.reason,
      created_by: params.adminId,
    });
    if (error) return { ok: false, error: 'OVERRIDE_GRANT_FAILED' };
    return { ok: true };
  }

  return { ok: false, error: 'PLAN_NOT_GRANTABLE' };
}

export async function handleListManualPayments(env: Env, request: Request): Promise<Response> {
  const admin = await requireAdmin(env, request);
  if (isResponse(admin)) return admin;

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'pending';

  const db = serviceClient(env);
  let query = db
    .from('manual_payment_requests')
    .select(
      'id, user_id, user_email, plan_id, amount_paise, utr_reference, note, status, review_note, reviewed_at, created_at, page_count, client_unlock_key, screenshot_base64'
    )
    .order('created_at', { ascending: false })
    .limit(200);
  if (status !== 'all') query = query.eq('status', status);
  const { data } = await query;

  return json({ requests: data ?? [] });
}

export async function handleApproveManualPayment(env: Env, request: Request, requestId: string): Promise<Response> {
  const admin = await requireAdmin(env, request);
  if (isResponse(admin)) return admin;

  const body = (await request.json().catch(() => ({}))) as { note?: string };
  const db = serviceClient(env);

  const { data: reqRow } = await db.from('manual_payment_requests').select('*').eq('id', requestId).maybeSingle();
  if (!reqRow) return json({ error: 'NOT_FOUND' }, 404);
  if (reqRow.status !== 'pending') return json({ error: 'ALREADY_REVIEWED' }, 409);

  if (reqRow.page_count && reqRow.client_unlock_key) {
    // Pay-per-page request: unlock exactly the document session that was
    // paid for (24h, same window the trial/credit paths use) — no wallet,
    // no entitlement override, nothing else to touch. The user's frontend
    // is polling GET /api/v1/manual-payments/:id and will notice this via
    // the request's own status flip, then re-check /unlocks itself.
    const validUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { data: existingUnlock } = await db
      .from('document_unlocks')
      .select('id')
      .eq('user_id', reqRow.user_id)
      .eq('client_unlock_key', reqRow.client_unlock_key)
      .maybeSingle();
    const { error: unlockErr } = existingUnlock
      ? await db.from('document_unlocks').update({ valid_until: validUntil }).eq('id', existingUnlock.id)
      : await db.from('document_unlocks').insert({
          user_id: reqRow.user_id,
          client_unlock_key: reqRow.client_unlock_key,
          source: 'manual_page_payment',
          valid_until: validUntil,
        });
    if (unlockErr) return json({ error: 'UNLOCK_GRANT_FAILED' }, 400);
  } else {
    const grant = await applyGrant(env, db, {
      userId: reqRow.user_id,
      planId: reqRow.plan_id,
      reason: 'manual_upi_purchase',
      adminId: admin.id,
      purchaseId: reqRow.id,
    });
    if (!grant.ok) return json({ error: grant.error }, 400);
  }

  await db
    .from('manual_payment_requests')
    .update({ status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: admin.id, review_note: body.note ?? null })
    .eq('id', requestId);

  return json({ ok: true });
}

export async function handleRejectManualPayment(env: Env, request: Request, requestId: string): Promise<Response> {
  const admin = await requireAdmin(env, request);
  if (isResponse(admin)) return admin;

  const body = (await request.json().catch(() => ({}))) as { note?: string };
  const db = serviceClient(env);

  const { data: reqRow } = await db.from('manual_payment_requests').select('id, status').eq('id', requestId).maybeSingle();
  if (!reqRow) return json({ error: 'NOT_FOUND' }, 404);
  if (reqRow.status !== 'pending') return json({ error: 'ALREADY_REVIEWED' }, 409);

  await db
    .from('manual_payment_requests')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: admin.id, review_note: body.note ?? null })
    .eq('id', requestId);

  return json({ ok: true });
}

// Ad-hoc grant not tied to a manual-payment request (e.g. goodwill credit,
// support-desk correction, or a payment collected entirely outside the app).
export async function handleAdminGrantEntitlement(env: Env, request: Request): Promise<Response> {
  const admin = await requireAdmin(env, request);
  if (isResponse(admin)) return admin;

  const body = (await request.json().catch(() => null)) as { userId?: string; planId?: string; reason?: string } | null;
  if (!body?.userId || !body?.planId) return json({ error: 'INVALID_BODY' }, 400);

  const db = serviceClient(env);
  const grant = await applyGrant(env, db, {
    userId: body.userId,
    planId: body.planId,
    reason: body.reason?.trim() || 'admin_grant',
    adminId: admin.id,
  });
  if (!grant.ok) return json({ error: grant.error }, 400);
  return json({ ok: true });
}

// Direct credit-only grant (bypasses plan lookup entirely — a raw amount).
export async function handleAdminGrantCredits(env: Env, request: Request): Promise<Response> {
  const admin = await requireAdmin(env, request);
  if (isResponse(admin)) return admin;

  const body = (await request.json().catch(() => null)) as { userId?: string; amount?: number; reason?: string } | null;
  if (!body?.userId || !Number.isInteger(body.amount) || body.amount === 0) return json({ error: 'INVALID_BODY' }, 400);

  const db = serviceClient(env);
  await db.from('credit_transactions').insert({
    user_id: body.userId,
    delta: body.amount,
    reason: body.reason?.trim() || (body.amount! > 0 ? 'admin_grant' : 'admin_revoke'),
  });
  const rpc = body.amount! > 0 ? 'increment_wallet_balance' : 'decrement_wallet_balance';
  const { error } = await db.rpc(rpc, { p_user_id: body.userId, p_amount: Math.abs(body.amount!) });
  if (error) return json({ error: 'CREDIT_ADJUST_FAILED' }, 400);
  return json({ ok: true });
}

export async function handleAdminGetEntitlement(env: Env, request: Request, userId: string): Promise<Response> {
  const admin = await requireAdmin(env, request);
  if (isResponse(admin)) return admin;
  return json(await loadEntitlement(env, userId));
}

// "Print count" in product terms is the trial's document-unlock counter
// (`trials.trial_unlocks_used`, spec section 8/18 — the app never learns
// whether a user's OS print dialog was actually used, only that a document
// was unlocked). This surfaces the raw row plus recent unlock history so an
// admin can see/adjust it without going to the Supabase SQL editor.
export async function handleAdminGetTrial(env: Env, request: Request, userId: string): Promise<Response> {
  const admin = await requireAdmin(env, request);
  if (isResponse(admin)) return admin;

  const db = serviceClient(env);
  const [{ data: trial }, { data: unlocks }] = await Promise.all([
    db.from('trials').select('*').eq('user_id', userId).maybeSingle(),
    db
      .from('document_unlocks')
      .select('id, source, unlocked_at, valid_until')
      .eq('user_id', userId)
      .order('unlocked_at', { ascending: false })
      .limit(50),
  ]);

  return json({ trial: trial ?? null, unlocks: unlocks ?? [] });
}

// Directly edits the trial row — e.g. give a customer a few extra free
// unlocks as goodwill, extend their trial window, or reset a miscounted
// value. Any field left out is kept as-is (or defaulted only on first
// creation of the row).
export async function handleAdminAdjustTrial(env: Env, request: Request): Promise<Response> {
  const admin = await requireAdmin(env, request);
  if (isResponse(admin)) return admin;

  const body = (await request.json().catch(() => null)) as
    | {
        userId?: string;
        trialUnlocksUsed?: number;
        trialUnlockLimit?: number;
        trialEndsAt?: string; // ISO date
      }
    | null;
  if (!body?.userId) return json({ error: 'INVALID_BODY' }, 400);

  const db = serviceClient(env);
  const { data: existing } = await db.from('trials').select('*').eq('user_id', body.userId).maybeSingle();
  const now = new Date().toISOString();

  const row = {
    user_id: body.userId,
    trial_started_at: existing?.trial_started_at ?? now,
    trial_ends_at: body.trialEndsAt ?? existing?.trial_ends_at ?? new Date(Date.now() + 7 * 86400000).toISOString(),
    trial_unlock_limit: body.trialUnlockLimit ?? existing?.trial_unlock_limit ?? 10,
    trial_unlocks_used: body.trialUnlocksUsed ?? existing?.trial_unlocks_used ?? 0,
  };

  const { error } = await db.from('trials').upsert(row, { onConflict: 'user_id' });
  if (error) return json({ error: 'TRIAL_ADJUST_FAILED' }, 500);
  return json({ ok: true, trial: row });
}

export async function handleAdminRevokeDevice(env: Env, request: Request, deviceId: string): Promise<Response> {
  const admin = await requireAdmin(env, request);
  if (isResponse(admin)) return admin;
  const db = serviceClient(env);
  const { error } = await db.from('devices').update({ revoked_at: new Date().toISOString() }).eq('id', deviceId);
  if (error) return json({ error: 'DEVICE_REVOKE_FAILED' }, 500);
  return json({ ok: true });
}

// Best-effort email lookup via Supabase's GoTrue admin REST API. Not verified
// against a live Supabase project as of this writing — if `?email=` filtering
// isn't supported on your project's GoTrue version, this returns an empty
// list rather than erroring; fall back to looking the user up by the email
// shown on their manual-payment request instead.
export async function handleAdminSearchUser(env: Env, request: Request): Promise<Response> {
  const admin = await requireAdmin(env, request);
  if (isResponse(admin)) return admin;

  const url = new URL(request.url);
  const email = url.searchParams.get('email');
  if (!email) return json({ error: 'INVALID_QUERY' }, 400);

  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
    });
    const data = await res.json().catch(() => null);
    const users = (data as any)?.users ?? (Array.isArray(data) ? data : []);
    return json({ users: users.map((u: any) => ({ id: u.id, email: u.email })) });
  } catch (err: any) {
    console.error('Admin user search failed:', err?.message);
    return json({ users: [] });
  }
}
