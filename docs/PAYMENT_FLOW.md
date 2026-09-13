# Payment & Entitlement Flows

## Print-button gate (the core monetization moment)

`apps/web/src/registry/print-gate.js::gatePrintDocument()`, wired to the
existing `printDocBtn` click in `apps/web/src/main.js`:

```
click Print Document
  → hasDocumentLoaded()?            no  → inline error, stop
  → auth.requireUser()              no  → login modal → resume this flow on success
  → GET /api/v1/entitlement
  → currentDeviceAllowed === false? yes → device-limit modal, stop
  → registerDevice() (idempotent)
  → unlimitedDocuments?             yes → openChecklistModal() [existing print flow, unchanged]
  → POST /api/v1/unlocks {clientUnlockKey}
      - already-unlocked & still valid → openChecklistModal()
      - trial/credit consumed         → openChecklistModal()
      - 402 no_entitlement            → pricing modal
```

`clientUnlockKey` is a random UUID generated per loaded document
(`setCurrentDocumentSessionKey`, regenerated on every new file load) — never
derived from the document's bytes or filename.

## Flex Pack (one-time, ₹99 / 25 credits)

```
Pricing modal → "Choose" on Flex
  → POST /api/v1/payments/order {planId: "flex_25"}
      (server looks up price from `plans`, creates a PENDING `purchases` row,
       creates the Cashfree order, returns payment_session_id)
  → Cashfree hosted checkout (modal)
  → poll GET /api/v1/payments/order/:orderId/status  ("Verifying payment...")
  → [independently] Cashfree calls POST /webhooks/cashfree/payments
      → signature verified → purchases.status = PAID
      → credit_transactions insert (idempotent per purchase_id) → wallet += 25
  → poll observes purchases.status === 'PAID' → UI shows success, refreshes entitlement
```

The poll endpoint is a **read-only convenience** for the UI — it never grants
anything. The webhook is the only path that mutates entitlement state.

## Professional/Business Annual (one-time prepaid, 365 days)

Same shape as Flex, except the plan's `billing_type` is `prepaid` (not
`prepaid_credits`) — the webhook marks the purchase `PAID` and does nothing
else; `computeEntitlement()` derives the 365-day validity window directly
from `purchases.paid_at + plans.validity_days` on every entitlement check, so
there's no separate "activation" step to get out of sync.

## Professional/Business Monthly (recurring)

```
Pricing modal → "Choose" on a monthly plan
  → POST /api/v1/subscriptions {planId}
      (creates an INITIALIZED `subscriptions` row, calls Cashfree create-subscription,
       returns subscription_session_id)
  → Cashfree hosted subscription checkout (UPI AutoPay / card mandate)
  → poll GET /api/v1/subscriptions/current  ("UPI mandate confirmation लंबित है...")
  → [independently] Cashfree calls POST /webhooks/cashfree/subscriptions
      → signature verified → subscriptions.status/current_period_end updated (idempotent SET, not increment)
  → poll observes status === 'ACTIVE' → unlimited entitlement active
```

## Cancellation

`POST /api/v1/subscriptions/:id/cancel` calls Cashfree's cancel endpoint,
sets `cancel_at_period_end = true` immediately for UI purposes, and lets the
subsequent webhook set the authoritative `status`/`cancelled_at`. Access
continues through `current_period_end` — the UI should show:

> Your Professional access remains active until <current_period_end>.

## Entitlement priority (server is the only source of truth)

`apps/worker/src/services/entitlement.ts::computeEntitlement()`, in order:
admin override → active Business subscription → active Professional
subscription → active prepaid annual → active free trial → available Flex
credits → none. Every branch is covered by `tests/unit/entitlement.test.js`.
