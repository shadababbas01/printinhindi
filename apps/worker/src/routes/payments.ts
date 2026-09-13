import type { Env } from '../index';
import { requireUser, isResponse } from '../middleware/auth';
import { serviceClient } from '../services/supabase';
import { createOrder, getOrderStatus, type CashfreeConfig } from '../services/cashfree';

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

// One-time purchases only: flex_10, professional_annual, business_annual.
// The client sends ONLY a planId — never an amount. The price is looked up
// server-side from the `plans` table, which is the only source of truth.
export async function handleCreateOrder(env: Env, request: Request): Promise<Response> {
  const user = await requireUser(env, request);
  if (isResponse(user)) return user;

  const body = (await request.json().catch(() => null)) as { planId?: string } | null;
  if (!body?.planId) return json({ error: 'INVALID_BODY' }, 400);

  const db = serviceClient(env);
  const { data: plan } = await db.from('plans').select('*').eq('id', body.planId).eq('is_active', true).maybeSingle();
  if (!plan) return json({ error: 'UNKNOWN_PLAN' }, 400);
  if (plan.billing_type !== 'prepaid' && plan.billing_type !== 'prepaid_credits') {
    return json({ error: 'PLAN_NOT_ONE_TIME' }, 400);
  }

  const { data: profile } = await db.from('profiles').select('phone').eq('user_id', user.id).maybeSingle();
  if (!profile?.phone) return json({ error: 'PHONE_REQUIRED_FOR_CHECKOUT' }, 400);

  const orderId = `order_${crypto.randomUUID()}`;
  const { error: insertErr } = await db.from('purchases').insert({
    user_id: user.id,
    plan_id: plan.id,
    provider: 'cashfree',
    provider_order_id: orderId,
    amount_paise: plan.amount_paise,
    status: 'PENDING',
  });
  if (insertErr) return json({ error: 'ORDER_RECORD_FAILED' }, 500);

  try {
    const result = await createOrder(cashfreeConfig(env), {
      orderId,
      amountRupees: plan.amount_paise / 100,
      customerId: user.id,
      customerPhone: profile.phone,
      customerEmail: user.email ?? undefined,
      returnUrl: `${env.APP_BASE_URL}/purchase/result?order_id=${orderId}`,
      notes: { planId: plan.id },
    });
    return json({ orderId, paymentSessionId: result.paymentSessionId });
  } catch (err: any) {
    await db.from('purchases').update({ status: 'FAILED' }).eq('provider_order_id', orderId);
    console.error('Cashfree order creation failed:', err?.message);
    return json({ error: 'CASHFREE_ORDER_FAILED' }, 502);
  }
}

// Called by the "Verifying payment..." screen. This is a CONVENIENCE status
// check for the UI only — it never grants entitlement itself. Entitlement is
// only ever mutated by the verified webhook handler (routes/webhooks.ts).
export async function handleOrderStatus(env: Env, request: Request, orderId: string): Promise<Response> {
  const user = await requireUser(env, request);
  if (isResponse(user)) return user;

  const db = serviceClient(env);
  const { data: purchase } = await db
    .from('purchases')
    .select('*')
    .eq('provider_order_id', orderId)
    .eq('user_id', user.id) // never let a user probe someone else's order
    .maybeSingle();
  if (!purchase) return json({ error: 'ORDER_NOT_FOUND' }, 404);

  // Optionally reconcile with Cashfree directly in case the webhook is delayed.
  if (purchase.status === 'PENDING') {
    try {
      const live = await getOrderStatus(cashfreeConfig(env), orderId);
      if (live.orderStatus === 'PAID' && purchase.status !== 'PAID') {
        // Do not grant credits/entitlement here — flag for the webhook path /
        // an admin reconciliation job to apply the SAME idempotent grant logic
        // used in routes/webhooks.ts, so there is exactly one code path that
        // ever mutates entitlement state.
        console.warn(`Order ${orderId} shows PAID at Cashfree but webhook has not processed it yet.`);
      }
    } catch (err: any) {
      console.error('Cashfree order status fetch failed:', err?.message);
    }
  }

  return json({ status: purchase.status, planId: purchase.plan_id });
}
