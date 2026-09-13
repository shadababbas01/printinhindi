// Cashfree API client. Verified against current official docs (fetched
// 2026-09): https://www.cashfree.com/docs/api-reference/payments/latest/orders/create
// and https://www.cashfree.com/devstudio/preview/pg/tools/webhookVerification
//
// IMPORTANT: re-check the official docs before go-live — Cashfree revises
// x-api-version periodically and this file pins one snapshot.

export type CashfreeEnv = 'sandbox' | 'production';

export interface CashfreeConfig {
  env: CashfreeEnv;
  clientId: string;
  clientSecret: string;
  apiVersion: string; // e.g. '2026-01-01'
}

function baseUrl(env: CashfreeEnv): string {
  return env === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
}

function headers(cfg: CashfreeConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-version': cfg.apiVersion,
    'x-client-id': cfg.clientId,
    'x-client-secret': cfg.clientSecret,
  };
}

export interface CreateOrderParams {
  orderId: string; // merchant-generated, unique per purchase row
  amountRupees: number; // whole rupees; convert from amount_paise / 100 at the call site
  customerId: string; // Supabase user id
  customerPhone: string; // required by Cashfree; collect in billing profile before checkout
  customerEmail?: string;
  returnUrl: string;
  notes?: Record<string, string>;
}

export interface CreateOrderResult {
  cfOrderId: string;
  paymentSessionId: string;
  orderStatus: string;
}

export async function createOrder(cfg: CashfreeConfig, params: CreateOrderParams): Promise<CreateOrderResult> {
  const res = await fetch(`${baseUrl(cfg.env)}/orders`, {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify({
      order_id: params.orderId,
      order_amount: params.amountRupees,
      order_currency: 'INR',
      customer_details: {
        customer_id: params.customerId,
        customer_phone: params.customerPhone,
        customer_email: params.customerEmail,
      },
      order_meta: {
        return_url: params.returnUrl,
      },
      order_note: JSON.stringify(params.notes ?? {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cashfree create order failed (${res.status}): ${body}`);
  }
  const json = (await res.json()) as any;
  return {
    cfOrderId: json.cf_order_id,
    paymentSessionId: json.payment_session_id,
    orderStatus: json.order_status,
  };
}

export async function getOrderStatus(cfg: CashfreeConfig, orderId: string): Promise<{ orderStatus: string; raw: unknown }> {
  const res = await fetch(`${baseUrl(cfg.env)}/orders/${encodeURIComponent(orderId)}`, {
    method: 'GET',
    headers: headers(cfg),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cashfree get order failed (${res.status}): ${body}`);
  }
  const json = (await res.json()) as any;
  return { orderStatus: json.order_status, raw: json };
}

// --- Subscriptions ---------------------------------------------------------
// NOTE: verify exact field names against the CURRENT Cashfree Subscriptions
// docs before go-live (spec section 14/36). This mirrors the documented
// create-subscription -> subscription_session_id -> hosted checkout flow.

export interface CreateSubscriptionParams {
  subscriptionId: string; // merchant-generated, unique
  planAmountRupees: number;
  intervalType: 'month';
  customerId: string;
  customerPhone: string;
  customerEmail?: string;
  returnUrl: string;
}

export interface CreateSubscriptionResult {
  cfSubscriptionId: string;
  subscriptionSessionId: string;
  status: string;
}

export async function createSubscription(
  cfg: CashfreeConfig,
  params: CreateSubscriptionParams
): Promise<CreateSubscriptionResult> {
  const res = await fetch(`${baseUrl(cfg.env)}/subscriptions`, {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify({
      subscription_id: params.subscriptionId,
      customer_details: {
        customer_id: params.customerId,
        customer_phone: params.customerPhone,
        customer_email: params.customerEmail,
      },
      plan_details: {
        plan_amount: params.planAmountRupees,
        plan_interval: 1,
        plan_interval_type: params.intervalType,
        plan_currency: 'INR',
      },
      authorization_details: {
        authorization_amount: 1,
      },
      subscription_meta: {
        return_url: params.returnUrl,
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cashfree create subscription failed (${res.status}): ${body}`);
  }
  const json = (await res.json()) as any;
  return {
    cfSubscriptionId: json.cf_subscription_id ?? json.subscription_id,
    subscriptionSessionId: json.subscription_session_id,
    status: json.subscription_status ?? json.status,
  };
}

export async function getSubscriptionStatus(
  cfg: CashfreeConfig,
  subscriptionId: string
): Promise<{ status: string; currentPeriodEnd: string | null; raw: unknown }> {
  const res = await fetch(`${baseUrl(cfg.env)}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'GET',
    headers: headers(cfg),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cashfree get subscription failed (${res.status}): ${body}`);
  }
  const json = (await res.json()) as any;
  return {
    status: json.subscription_status ?? json.status,
    currentPeriodEnd: json.current_period_end ?? null,
    raw: json,
  };
}

export async function cancelSubscription(cfg: CashfreeConfig, subscriptionId: string): Promise<void> {
  const res = await fetch(`${baseUrl(cfg.env)}/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
    method: 'POST',
    headers: headers(cfg),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cashfree cancel subscription failed (${res.status}): ${body}`);
  }
}

// --- Webhook signature verification ----------------------------------------
// Verified 2026-09 against Cashfree's documented method: base64(HMAC-SHA256(
// clientSecret, timestamp + rawBody)) compared to the `x-webhook-signature`
// header. Timestamp comes from `x-webhook-timestamp`. MUST use the raw,
// unparsed request body — re-serializing JSON will change the byte sequence
// and break verification even when the data is "the same".
export async function verifyWebhookSignature(
  clientSecret: string,
  rawBody: string,
  timestampHeader: string,
  signatureHeader: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(clientSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(timestampHeader + rawBody));
  const computed = btoa(String.fromCharCode(...new Uint8Array(signed)));
  // Constant-time compare
  if (computed.length !== signatureHeader.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
  return diff === 0;
}
