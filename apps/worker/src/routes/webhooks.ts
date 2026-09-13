import type { Env } from '../index';
import { serviceClient } from '../services/supabase';
import { verifyWebhookSignature } from '../services/cashfree';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Records the event and returns whether this is the FIRST time we've seen it.
// The (provider, event_key) unique constraint (0001_init.sql) is what makes
// this safe under concurrent duplicate deliveries — a second insert for the
// same key throws a unique-violation, which we treat as "already processed".
async function recordEventOnce(
  env: Env,
  provider: string,
  eventKey: string,
  eventType: string,
  payload: unknown
): Promise<boolean> {
  const db = serviceClient(env);
  const { error } = await db.from('payment_webhook_events').insert({
    provider,
    event_key: eventKey,
    event_type: eventType,
    payload,
  });
  if (error) {
    // Postgres unique_violation code is 23505 — treat as duplicate, not a failure.
    if ((error as any).code === '23505') return false;
    throw error;
  }
  return true;
}

async function markProcessed(env: Env, provider: string, eventKey: string, err?: string) {
  const db = serviceClient(env);
  await db
    .from('payment_webhook_events')
    .update({ processed_at: new Date().toISOString(), processing_error: err ?? null })
    .eq('provider', provider)
    .eq('event_key', eventKey);
}

export async function handlePaymentWebhook(env: Env, request: Request): Promise<Response> {
  const rawBody = await request.text();
  const timestamp = request.headers.get('x-webhook-timestamp') || '';
  const signature = request.headers.get('x-webhook-signature') || '';

  const valid = await verifyWebhookSignature(env.CASHFREE_CLIENT_SECRET, rawBody, timestamp, signature);
  if (!valid) {
    console.warn('Rejected payment webhook: invalid signature');
    return json({ error: 'INVALID_SIGNATURE' }, 401);
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: 'MALFORMED_PAYLOAD' }, 400);
  }

  const orderId: string | undefined = payload?.data?.order?.order_id;
  const orderStatus: string | undefined = payload?.data?.order?.order_status ?? payload?.data?.payment?.payment_status;
  const eventKey: string = payload?.data?.payment?.cf_payment_id
    ? `payment_${payload.data.payment.cf_payment_id}`
    : `order_${orderId}_${payload?.type ?? 'unknown'}`;

  const isNew = await recordEventOnce(env, 'cashfree', eventKey, payload?.type ?? 'PAYMENT_WEBHOOK', payload);
  if (!isNew) {
    // Duplicate delivery — acknowledge success without reprocessing, so
    // Cashfree stops retrying, but we never grant credits/entitlement twice.
    return json({ ok: true, duplicate: true });
  }

  try {
    if (!orderId) throw new Error('Webhook payload missing order_id');

    const db = serviceClient(env);
    const { data: purchase } = await db.from('purchases').select('*').eq('provider_order_id', orderId).maybeSingle();
    if (!purchase) throw new Error(`No purchase row found for order_id=${orderId}`);

    if (orderStatus === 'PAID' && purchase.status !== 'PAID') {
      await db
        .from('purchases')
        .update({ status: 'PAID', paid_at: new Date().toISOString(), provider_payment_id: payload?.data?.payment?.cf_payment_id ?? null })
        .eq('id', purchase.id);

      const { data: plan } = await db.from('plans').select('*').eq('id', purchase.plan_id).maybeSingle();
      if (plan?.billing_type === 'prepaid_credits' && plan.included_credits) {
        // Idempotent even if somehow re-entered: check for an existing grant tx for this purchase first.
        const { data: existingGrant } = await db
          .from('credit_transactions')
          .select('id')
          .eq('purchase_id', purchase.id)
          .eq('reason', 'flex_purchase')
          .maybeSingle();
        if (!existingGrant) {
          await db.from('credit_transactions').insert({
            user_id: purchase.user_id,
            delta: plan.included_credits,
            reason: 'flex_purchase',
            purchase_id: purchase.id,
            expires_at: new Date(Date.now() + (plan.validity_days ?? 90) * 86400000).toISOString(),
          });
          await db.rpc('increment_wallet_balance', { p_user_id: purchase.user_id, p_amount: plan.included_credits });
        }
      }
      // prepaid (annual) plans need no further action here — computeEntitlement
      // derives their validity window directly from purchases.paid_at + validity_days.
    } else if (orderStatus && orderStatus !== 'PAID') {
      await db.from('purchases').update({ status: orderStatus }).eq('id', purchase.id);
    }

    await markProcessed(env, 'cashfree', eventKey);
    return json({ ok: true });
  } catch (err: any) {
    await markProcessed(env, 'cashfree', eventKey, err?.message);
    console.error('Payment webhook processing failed:', err?.message);
    // Still 200 so Cashfree doesn't hammer retries for a data problem we've
    // logged; the payment_webhook_events row preserves the payload for replay.
    return json({ ok: false, logged: true });
  }
}

export async function handleSubscriptionWebhook(env: Env, request: Request): Promise<Response> {
  const rawBody = await request.text();
  const timestamp = request.headers.get('x-webhook-timestamp') || '';
  const signature = request.headers.get('x-webhook-signature') || '';

  const valid = await verifyWebhookSignature(env.CASHFREE_CLIENT_SECRET, rawBody, timestamp, signature);
  if (!valid) {
    console.warn('Rejected subscription webhook: invalid signature');
    return json({ error: 'INVALID_SIGNATURE' }, 401);
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: 'MALFORMED_PAYLOAD' }, 400);
  }

  const subscriptionId: string | undefined = payload?.data?.subscription?.subscription_id ?? payload?.data?.subscription_id;
  const status: string | undefined = payload?.data?.subscription?.subscription_status ?? payload?.data?.subscription_status;
  const currentPeriodEnd: string | undefined = payload?.data?.subscription?.current_period_end;
  const eventKey = `${subscriptionId}_${payload?.type ?? 'unknown'}_${payload?.data?.subscription?.subscription_status ?? ''}_${currentPeriodEnd ?? ''}`;

  const isNew = await recordEventOnce(env, 'cashfree', eventKey, payload?.type ?? 'SUBSCRIPTION_WEBHOOK', payload);
  if (!isNew) return json({ ok: true, duplicate: true });

  try {
    if (!subscriptionId) throw new Error('Webhook payload missing subscription_id');
    const db = serviceClient(env);

    // Applying the SAME (status, current_period_end) twice is a no-op update,
    // not a duplicate period extension — idempotent by construction since we
    // set values rather than incrementing them.
    const { error } = await db
      .from('subscriptions')
      .update({
        status: status ?? 'ACTIVE',
        current_period_end: currentPeriodEnd ?? null,
        raw_provider_status: JSON.stringify(payload?.data?.subscription ?? {}),
        cancelled_at: status === 'CANCELLED' ? new Date().toISOString() : null,
      })
      .eq('provider_subscription_id', subscriptionId);
    if (error) throw error;

    await markProcessed(env, 'cashfree', eventKey);
    return json({ ok: true });
  } catch (err: any) {
    await markProcessed(env, 'cashfree', eventKey, err?.message);
    console.error('Subscription webhook processing failed:', err?.message);
    return json({ ok: false, logged: true });
  }
}
