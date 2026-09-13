# Cashfree Manual Setup

Everything below must be done by you in the Cashfree merchant dashboard —
no API can automate merchant onboarding.

## 1. Create a Cashfree account and complete KYC
Sign up at https://merchant.cashfree.com. Full payment gateway activation
requires business KYC approval (PAN, bank account, business proof). Until
approved you can fully develop/test against **sandbox** credentials.

## 2. Get sandbox API credentials
Dashboard → Developers → API Keys → Sandbox. Copy:
- `x-client-id`
- `x-client-secret`

Set these as Worker secrets (never in frontend code or git):
```bash
cd apps/worker
wrangler secret put CASHFREE_CLIENT_ID
wrangler secret put CASHFREE_CLIENT_SECRET
```

## 3. Enable Subscriptions
Subscriptions (used for Professional/Business Monthly) may need to be
explicitly enabled for your merchant account — contact Cashfree support if
`/pg/subscriptions` returns a permissions error in sandbox.

## 4. Configure webhooks
Dashboard → Developers → Webhooks. Add both:
- Payments webhook → `https://<your-worker-domain>/api/v1/webhooks/cashfree/payments`
- Subscriptions webhook → `https://<your-worker-domain>/api/v1/webhooks/cashfree/subscriptions`

Cashfree signs every webhook with your **client secret** (HMAC-SHA256 of
`timestamp + raw_body`, base64-encoded, in the `x-webhook-signature` header —
implemented in `apps/worker/src/services/cashfree.ts::verifyWebhookSignature`
and covered by `tests/unit/webhook-signature.test.js`). There is nothing
further to configure for signing — it uses the same client secret as the API.

## 5. Whitelist your domain
Dashboard → Developers → domain whitelisting, for both the hosted checkout
return URL and (if applicable) the subscription authorization return URL.
Use your real production domain before going live; sandbox typically allows
`localhost`.

## 6. Before accepting real payments
- [ ] KYC approved, live credentials issued
- [ ] Switch `CASHFREE_ENV` to `production` in `wrangler.toml` (or per-env override)
- [ ] Swap sandbox client id/secret for production ones (`wrangler secret put` again, in the production environment)
- [ ] Re-whitelist your production domain
- [ ] Re-verify current API field names against official docs — Cashfree
      revises `x-api-version` periodically:
      - https://www.cashfree.com/docs/api-reference/payments/latest/orders/create
      - https://www.cashfree.com/docs/payments/subscription/introduction
      - https://www.cashfree.com/docs/payments/subscription/create
      - https://www.cashfree.com/docs/payments/subscription/hosted-checkout
      - https://www.cashfree.com/docs/payments/subscription/manage
      - https://www.cashfree.com/docs/payments/subscription/webhooks
      - https://www.cashfree.com/devstudio/preview/pg/tools/webhookVerification
- [ ] Run a real ₹1 (or minimum-allowed) live transaction before wide launch

## What was verified during implementation (2026-09)

- Order creation endpoint, headers, and `payment_session_id` response field —
  confirmed via official docs.
- Webhook signature algorithm (HMAC-SHA256 of `timestamp + raw_body`, base64,
  compared to `x-webhook-signature`, timestamp from `x-webhook-timestamp`) —
  confirmed and unit-tested against a real HMAC computation.
- Subscriptions field names (`plan_details`, `subscription_session_id`, etc.)
  in `apps/worker/src/services/cashfree.ts` are based on the documented
  create-subscription → hosted-checkout flow shape, but were **not**
  independently re-verified field-by-field against a live sandbox response in
  this pass — do that before wiring up real subscription checkout.
