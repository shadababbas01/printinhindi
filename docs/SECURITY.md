# Security Posture

## Secrets

| Secret | Where it lives | Never in |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Worker secret (`wrangler secret put`) | frontend bundle, git |
| `CASHFREE_CLIENT_SECRET` | Worker secret | frontend bundle, git |
| `CASHFREE_CLIENT_ID` | Worker secret (not sensitive alone, but kept server-side for consistency) | — |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Frontend `.env` (public by design) | — |

Verified: `apps/web/src` contains no `SERVICE_ROLE` or `CASHFREE_CLIENT_SECRET`
string; grep before every deploy:
```bash
grep -rn "SERVICE_ROLE\|CLIENT_SECRET" apps/web/dist && echo "LEAK FOUND" || echo "clean"
```

## Payment trust boundary

- The browser **never** sends an amount — `POST /api/v1/payments/order` and
  `POST /api/v1/subscriptions` take only a `planId`; the Worker looks up the
  price from `plans` (`apps/worker/src/routes/payments.ts`,
  `subscriptions.ts`).
- Entitlement is only ever mutated by `apps/worker/src/routes/webhooks.ts`
  after `verifyWebhookSignature()` succeeds. A redirect back from Cashfree,
  or a client claiming `"paid": true`, does nothing on its own — see
  `handleOrderStatus` in `payments.ts`, which explicitly does not grant
  anything even when it observes a `PAID` order live from Cashfree (it logs
  a warning for reconciliation instead).

## Webhook idempotency

`payment_webhook_events` has a `unique(provider, event_key)` constraint
(`supabase/migrations/0001_init.sql`). A second insert for the same event
throws Postgres error `23505`, which the handler treats as "already
processed" and returns success without reprocessing — see
`tests/unit/webhook-idempotency.test.js` for the contract this depends on,
and `recordEventOnce()` in `webhooks.ts` for the real implementation.

Credit grants are additionally guarded per-purchase (`credit_transactions`
is checked for an existing `reason = 'flex_purchase'` row for that
`purchase_id` before granting again) — belt-and-suspenders against a
duplicate grant even if the event-key derivation ever collides.

## Row Level Security

Every user-facing table has RLS enabled (`supabase/migrations/0002_rls.sql`).
Authenticated users can only **read** their own subscriptions, purchases,
credit wallet/transactions, document unlocks, devices, and trial row — there
are **no** insert/update/delete policies granted to the `authenticated` role
on any billing/entitlement table, so a user cannot self-grant credits or
alter their own subscription status even with a crafted direct Supabase
client call. All writes to those tables happen through the Worker's
service-role client, which bypasses RLS entirely and never runs in the
browser.

## Rate limiting

**Not yet implemented.** Recommended: Cloudflare's built-in rate limiting
rules (dashboard-configured, no code change) on:
- `/api/v1/payments/order` and `/api/v1/subscriptions` (payment creation)
- Supabase's own rate limits apply to `signInWithOtp` (used for both the
  email sign-in link and the phone OTP fallback) — configure the
  cooldown/expiry in Supabase Auth settings (Auth → Rate Limits).

## Admin authorization

`apps/worker/src/middleware/auth.ts::isAdmin()` currently checks a static
`ADMIN_EMAIL_ALLOWLIST` env var. This is a deliberately minimal placeholder —
before building the admin portal (spec section 27), replace it with a proper
`admins` table or Supabase custom claim, and add audit logging for every
admin-initiated entitlement/credit change.

## Logging

Worker route handlers log only error messages (`err.message`), never full
provider payloads or document-adjacent data, to `console.error`/`console.warn`
(visible in `wrangler tail` / Cloudflare dashboard). `payment_webhook_events.payload`
does store the raw webhook JSON for audit — this contains payment metadata
(amounts, order/subscription IDs) but never registry document content, since
document content is never transmitted to the Worker at all.

## Things NOT done in this pass — do before go-live

- [ ] Rate limiting on payment-sensitive endpoints (Cloudflare dashboard rule)
- [ ] Idempotency-Key header handling for double-click purchase/subscription
      creation (currently relies on the browser disabling the button while a
      request is in flight — `pricing-ui.js` does this, but a server-side
      idempotency key would be stronger)
- [ ] Admin portal + real admin role table
- [ ] CSP header configuration for the deployed Pages site
- [ ] Automated secret-scanning in CI
