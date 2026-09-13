# Hindi Registry Print Tool — Monetized SaaS

Loads `.docx` registry documents, converts/renders Hindi text (incl. Kruti Dev
010 / Devlys auto-detection), paginates for legal/A4 stamp paper, and prints —
entirely client-side. Accounts, entitlements, payments and device licensing
are handled by a separate Cloudflare Worker + Supabase backend; **registry
document content never reaches that backend.**

## Repository layout

```
apps/web/      Vite app — the print tool (index.html) + auth/billing modules
apps/worker/   Cloudflare Worker API (auth-gated entitlement/payment routes)
supabase/      SQL migrations + seed data
tests/unit/    Vitest — regression tests for the document engine + backend logic
docs/          Setup/deployment/security/payment-flow documentation
```

The original, untouched working file is preserved at
`apps/web/BASELINE_hindi-registry-tool-phase1.html` — treat it as the
reference for "does this refactor still behave the same way".

## Quick start (local dev)

```bash
npm install

# 1. Run the regression test suite (no credentials needed)
npm test

# 2. Fill in real values, then start each app
cp apps/web/.env.example apps/web/.env.local        # Supabase URL/publishable key, API base URL
# apps/worker secrets are NOT a .env file — see "Worker secrets" below
npm run dev:web       # Vite dev server, http://localhost:5173
npm run dev:worker    # Wrangler dev server, http://localhost:8787
```

## Worker secrets (never committed)

```bash
cd apps/worker
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put CASHFREE_CLIENT_ID
wrangler secret put CASHFREE_CLIENT_SECRET
```

Non-secret config (Cashfree environment, allowed CORS origin, app base URL,
admin email allow-list) lives in `apps/worker/wrangler.toml`.

## Admin panel + manual UPI payments

`apps/web/admin.html` is a lightweight admin panel (approve/reject manual UPI
payment requests, grant plans/credits by hand, look up a user's
entitlement). Set `ADMIN_EMAIL_ALLOWLIST` in `apps/worker/wrangler.toml`
first — every admin route denies by default. See
`docs/MANUAL_UPI_PAYMENTS.md` for the full flow and how to change the UPI ID.

## Supabase setup

```bash
supabase link --project-ref <your-project-ref>
supabase db push                 # applies supabase/migrations/*.sql in order
psql "$DATABASE_URL" -f supabase/seed.sql   # or run seed.sql via the SQL editor
```

## Deploying

```bash
npm run dev:worker -- deploy     # or: cd apps/worker && wrangler deploy
cd apps/web && npm run build     # outputs apps/web/dist — deploy to Cloudflare Pages
```

See `docs/DEPLOYMENT.md` for the full checklist.

## Tests

```bash
npm test          # Vitest — 82 passing unit tests covering:
                   #   - Kruti Dev/Devlys conversion regression (verbatim-extracted from the app)
                   #   - Devanagari mark normalization
                   #   - entitlement priority-order computation
                   #   - credit/trial/document-unlock decisions
                   #   - device-limit decisions
                   #   - Cashfree webhook signature verification (real HMAC-SHA256)
                   #   - webhook idempotency contract
                   #   - manual/admin grant mechanism selection per plan type
```

Playwright E2E scaffolding is **not yet implemented** — it requires a running
Supabase project + Cashfree sandbox account to exercise real login/checkout
flows and was out of scope for this pass. See `KNOWN LIMITATIONS` in the
implementation report / `docs/DEPLOYMENT.md`.

## Documentation

- `docs/CASHFREE_SETUP.md` — merchant dashboard steps you must do manually
- `docs/SUPABASE_SETUP` (see README above) + `docs/SECURITY.md` — RLS/auth posture
- `docs/PAYMENT_FLOW.md` — end-to-end flow diagrams for each plan type
- `docs/DEPLOYMENT.md` — production deployment checklist
