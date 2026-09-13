import type { Env } from '../index';
import { requireUser, isResponse } from '../middleware/auth';
import { serviceClient } from '../services/supabase';
import { createSubscription, cancelSubscription, type CashfreeConfig } from '../services/cashfree';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function cashfreeConfig(env: Env): CashfreeConfig {
  return {
    env: env.CASHFREE_ENV,
    clientId: env.CASHFREE_CLIENT_ID,
    clientSecret: env.CASHFREE_CLIENT_SECRET,
    apiVersion: env.CASHFREE_API_VERSION,
  };
}

// Recurring plans only: professional_monthly, business_monthly.
export async function handleCreateSubscription(env: Env, request: Request): Promise<Response> {
  const user = await requireUser(env, request);
  if (isResponse(user)) return user;

  const body = (await request.json().catch(() => null)) as { planId?: string } | null;
  if (!body?.planId) return json({ error: 'INVALID_BODY' }, 400);

  const db = serviceClient(env);
  const { data: plan } = await db.from('plans').select('*').eq('id', body.planId).eq('is_active', true).maybeSingle();
  if (!plan || plan.billing_type !== 'recurring') return json({ error: 'PLAN_NOT_RECURRING' }, 400);

  const { data: profile } = await db.from('profiles').select('phone').eq('user_id', user.id).maybeSingle();
  if (!profile?.phone) return json({ error: 'PHONE_REQUIRED_FOR_CHECKOUT' }, 400);

  const subscriptionId = `sub_${crypto.randomUUID()}`;
  const { error: insertErr } = await db.from('subscriptions').insert({
    user_id: user.id,
    plan_id: plan.id,
    provider: 'cashfree',
    provider_subscription_id: subscriptionId,
    status: 'INITIALIZED',
  });
  if (insertErr) return json({ error: 'SUBSCRIPTION_RECORD_FAILED' }, 500);

  try {
    const result = await createSubscription(cashfreeConfig(env), {
      subscriptionId,
      planAmountRupees: plan.amount_paise / 100,
      intervalType: 'month',
      customerId: user.id,
      customerPhone: profile.phone,
      customerEmail: user.email ?? undefined,
      returnUrl: `${env.APP_BASE_URL}/billing?subscription_id=${subscriptionId}`,
    });
    return json({ subscriptionId, subscriptionSessionId: result.subscriptionSessionId });
  } catch (err: any) {
    await db.from('subscriptions').update({ status: 'FAILED' }).eq('provider_subscription_id', subscriptionId);
    console.error('Cashfree subscription creation failed:', err?.message);
    return json({ error: 'CASHFREE_SUBSCRIPTION_FAILED' }, 502);
  }
}

export async function handleCurrentSubscription(env: Env, request: Request): Promise<Response> {
  const user = await requireUser(env, request);
  if (isResponse(user)) return user;
  const db = serviceClient(env);
  const { data } = await db
    .from('subscriptions')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return json({ subscription: data ?? null });
}

export async function handleCancelSubscription(env: Env, request: Request, id: string): Promise<Response> {
  const user = await requireUser(env, request);
  if (isResponse(user)) return user;

  const db = serviceClient(env);
  const { data: sub } = await db
    .from('subscriptions')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id) // never let a user cancel someone else's subscription
    .maybeSingle();
  if (!sub) return json({ error: 'SUBSCRIPTION_NOT_FOUND' }, 404);

  try {
    if (sub.provider_subscription_id) {
      await cancelSubscription(cashfreeConfig(env), sub.provider_subscription_id);
    }
  } catch (err: any) {
    console.error('Cashfree cancel failed:', err?.message);
    return json({ error: 'CANCEL_FAILED' }, 502);
  }

  // Access remains through the paid period; the webhook will move status to
  // CANCELLED/EXPIRED once Cashfree confirms it. We record intent immediately
  // so the UI can show "cancels at period end" without waiting on a webhook.
  await db.from('subscriptions').update({ cancel_at_period_end: true }).eq('id', id);
  return json({ ok: true, accessUntil: sub.current_period_end });
}
