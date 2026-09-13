# Manual UPI Payments + Admin Panel

A stopgap purchase path for launch, alongside (or instead of) Cashfree: the
customer pays a UPI QR directly, submits a UTR/transaction ID (and
optionally a payment screenshot) in the app, and an admin reviews it in a
lightweight admin panel before entitlement is granted. This is **not** in
the original monetization spec (`HINDI_REGISTRY_MONETIZATION_IMPLEMENTATION
_SPEC.md`) — it was added as a way to start collecting real payments before
Cashfree KYC/merchant setup is complete.

## Why this exists

Cashfree requires merchant KYC and (for Subscriptions) manual enablement by
Cashfree support before it can process real payments. This flow lets you take
your first customers on a personal or business UPI ID in the meantime — at
the cost of manual verification instead of instant automated unlock.

**This does not replace the security posture of the rest of the app.** The
same trust rule applies: a user-submitted UTR/reference number (or
screenshot) never grants access by itself. Only an admin's explicit approval
(via the Worker's service-role client) writes to `entitlement_overrides` /
`credit_transactions` / `document_unlocks`.

## The flow (both plan-based and pay-per-page)

```text
User uploads document
        ↓
Clicks Print
        ↓
Payment screen — ₹99 / ₹349 / ₹10-per-page etc.
UPI QR displayed (amount pre-filled)
        ↓
User pays in their UPI app
        ↓
Clicks "मैंने भुगतान कर दिया है / I have paid"
        ↓
Enters UTR / Transaction ID
(+ optional screenshot)
        ↓
Payment request = PENDING
(apps/web polls GET /api/v1/manual-payments/:id every few seconds)
        ↓
Admin opens /admin.html, sees the pending request
        ↓
Admin checks their own UPI/bank app for the matching payment
        ↓
   [Approve]         [Reject]
        ↓
   APPROVE
        ↓
User's browser automatically detects it (polling, no refresh needed):
"भुगतान सत्यापित ✅ / Payment Verified ✅"
        ↓
Printing proceeds automatically (per-page), or the plan
activates and the user presses Print again (plan-based)
```

## How it works, in code

1. **Plan-based** (Flex/Professional/Business/Annual): on the pricing modal,
   each plan has a secondary **"UPI QR से भुगतान करें / Pay via UPI"** button
   next to the normal Cashfree "Choose" button
   (`apps/web/src/ui/pricing-ui.js` → `apps/web/src/ui/manual-payment-ui.js`).
2. **Pay-per-page**: when Print is clicked and there's no active
   entitlement (no trial left, no credits, no plan) — or the backend
   entitlement system is simply unreachable — the app shows a **"Pay per
   page"** modal instead of blocking (`apps/web/src/ui/page-payment-ui.js`),
   priced at the per-page rate (`plans.id='per_page_print'`, seeded at
   ₹10/page) × the current document's page count
   (`window.__registryHooks.getPageCount()`, tracked in `index.html`'s
   `renderPreview()`).
3. Both modals render a UPI QR with the **exact amount pre-filled**
   (`apps/web/src/billing/upi-qr.js`, using the `qrcode` npm package).
4. The customer pays, clicks **"I have paid"**, which reveals a UTR/
   Transaction ID field and an optional screenshot file input
   (`apps/web/src/ui/screenshot-input.js` reads it as a base64 data URL —
   no Supabase Storage bucket needed).
5. Submitting creates a `pending` row in `manual_payment_requests` via
   `POST /api/v1/manual-payments` (plan-based) or
   `POST /api/v1/manual-payments/per-page` (per-page). Nothing is granted
   yet.
6. The modal immediately starts polling `GET /api/v1/manual-payments/:id`
   (`apps/web/src/billing/payment-status-poll.js`, every 4s, up to 10
   minutes) and shows a "Verifying payment..." state.
7. An admin opens `/admin.html`, signs in with a Supabase sign-in link (same
   auth as the main app), and sees the pending list — including the page
   count for per-page requests and a thumbnail of the screenshot if one was
   attached (click it for a full-size lightbox). They check their own UPI/
   bank app for the matching payment, then **Approve** or **Reject** (with
   an optional note).
8. **Approve**: plan-based requests get the plan/credits granted the usual
   way (`applyGrant`, see below); per-page requests get exactly that one
   document session unlocked (`document_unlocks`, 24h). Either way, the
   next poll tick on the user's still-open modal sees `status: 'approved'`
   and reacts — per-page continues straight to printing automatically;
   plan-based refreshes the user's entitlement and shows "Payment Verified
   ✅" (they press Print again to use it).
9. **Reject**: the modal shows the rejection (with the admin's note if any)
   so the user can fix and resubmit.
10. If nobody's reviewed it within the polling window, the modal just says
    "still pending, check back later" rather than hanging forever — closing
    the modal doesn't cancel the request, it's still sitting there pending
    for the admin to review whenever.

## Changing the UPI ID

The payee UPI ID/name are read from env vars in `apps/web/src/billing/upi-qr.js`
(never hardcoded — this repo is public):

```env
VITE_UPI_ID=your-upi-id@bank
VITE_UPI_PAYEE_NAME=Your Name
```

Set these in `apps/web/.env.local` (gitignored) for local dev, and as build-time
env vars on whatever platform builds/deploys the frontend for production.
Update to a business UPI ID/current account once volume grows — a personal
savings account isn't a good long-term place to receive commercial payments.

## Granting admin access

Every `/api/v1/admin/*` route requires the caller's email to be in
`ADMIN_EMAIL_ALLOWLIST` (`apps/worker/src/middleware/auth.ts::isAdmin`), a
comma-separated list set in `apps/worker/wrangler.toml` or as a Worker
secret. Denies by default — no emails configured means nobody has access.

```toml
# apps/worker/wrangler.toml
[vars]
ADMIN_EMAIL_ALLOWLIST = "you@example.com,teammate@example.com"
```

Redeploy the Worker after changing this.

## What the admin panel (`/admin.html`) can do

- **Review manual UPI payment requests** — approve or reject (with an
  optional note), filterable by status. Per-page requests show their page
  count next to the plan id; a payment screenshot (if attached) shows as a
  thumbnail, click for full size.
- **Grant a plan manually** — for payments collected entirely outside the
  app, or support corrections. Needs the customer's Supabase user ID.
- **Adjust credits directly** — add or remove Flex credits by a raw amount.
- **Manage a user's print count (free trial)** — view and edit the trial's
  raw `trials` row (unlocks used, unlock limit, trial end date) plus their
  recent document-unlock history, without needing the Supabase SQL editor.
  "Print count" here means the document-unlock counter — the app can't
  detect whether the OS print dialog was actually used, only that a
  document was unlocked.
- **Look up a user's entitlement** — pastes the same JSON the app's
  `/api/v1/entitlement` endpoint would return, for support debugging.
- **Search a user by email** — best-effort; depends on your Supabase
  project's GoTrue admin API supporting `?email=` filtering. If it returns
  nothing, use the email already shown on a manual-payment request row
  instead — every request stores the submitter's email at creation time.

## What it does NOT do (yet)

- No webhook-delivery diagnostics view — inspect `payment_webhook_events`
  directly in the Supabase dashboard if a Cashfree webhook needs
  troubleshooting.
- No device-revocation UI in `/admin.html` yet, though the backend route
  (`POST /api/v1/admin/devices/:deviceId/revoke`) exists — call it directly
  or extend the panel.
- No audit log beyond what's already in `entitlement_overrides.reason` /
  `credit_transactions.reason`, and `.reviewed_by`/`.review_note` on manual
  payment requests.
- No cross-device push notification when a request is approved — the
  browser tab that submitted it has to still be open and polling; if it was
  closed, the user just needs to open the app and press Print again (the
  approval already happened server-side, so it'll be picked up immediately).

## How a plan-based grant is actually recorded

`apps/worker/src/services/grants.ts::planGrantMechanism()` (pure, unit-tested
in `tests/unit/grants.test.js`) decides how each plan type is granted:

| Plan `billing_type` | Mechanism | Table |
|---|---|---|
| `prepaid_credits` (Flex) | Credit grant, plan's `validity_days` | `credit_transactions` + `credit_wallets` |
| `prepaid` (Annual) | Entitlement override, plan's `validity_days` | `entitlement_overrides` |
| `recurring` (Monthly/yearly) | Entitlement override, 30 or 365 days | `entitlement_overrides` |
| `free` (Trial) | Not grantable this way | — |
| `per_page` (Per-Page Print) | Not grantable this way — see below | — |

This reuses the exact same tables `computeEntitlement()` already reads for
Cashfree-driven purchases — no separate entitlement code path to keep in sync.

Per-page requests are handled by a **separate** branch in
`routes/admin.ts::handleApproveManualPayment` (checked before
`planGrantMechanism` is ever consulted): it writes directly to
`document_unlocks` for the specific `client_unlock_key` on the request, not
to credits or entitlement overrides. `per_page` is excluded from
`planGrantMechanism` (returns `unsupported`) and filtered out of the admin
panel's "Grant a plan manually" dropdown specifically so it can never be
accidentally granted through the generic subscription/credit-pack path.

## Screenshot storage

Screenshots are stored inline as a base64 data URL directly on the
`manual_payment_requests` row (`screenshot_base64` column,
`supabase/migrations/0006_payment_screenshot.sql`) — no Supabase Storage
bucket to configure. Capped at ~700KB of base64 (~500KB image) in
`apps/worker/src/routes/manual-payments.ts::validateScreenshot`, purely to
keep rows small; the client also just sends whatever the browser's
`FileReader` produces, so a very large photo may get rejected by that cap —
tell users a cropped/compressed screenshot works better than a full-res
camera photo if this comes up.
