# Deployment Checklist

## 1. Supabase

```bash
supabase link --project-ref <ref>
supabase db push                              # runs supabase/migrations/*.sql
psql "$DATABASE_URL" -f supabase/seed.sql     # seeds the plan catalog
```
In the Supabase dashboard:
- Auth → URL Configuration: set Site URL and allowed redirect URLs to your
  production domain.
- Auth → Email Templates → Magic Link: this is the template used for sign-in —
  make sure it contains `{{ .ConfirmationURL }}` (email login is link-based,
  click it, nothing to type).
- Auth → Rate Limits: confirm magic-link send limits suit expected traffic.
- Auth → SMTP Settings: the built-in mailer is rate-limited (dev/testing
  only) — configure a real SMTP provider (Resend, SendGrid, Postmark, etc.)
  before real users depend on receiving login emails.
- Auth → Providers → Phone: enable Phone auth, then configure an SMS
  provider (Twilio, MessageBird, Vonage, or Twilio Verify) with its
  account SID/API key/sender ID — this is what actually sends the mobile
  OTP (`apps/web/src/ui/login-ui.js`'s "मोबाइल / Mobile" tab; phone auth has
  no clickable-link option, so this path stays a typed 6-digit code). Each
  SMS costs money per send via your chosen provider; email has no per-send
  cost, so mobile is meant as a fallback for when email delivery is down/
  slow, not the default path. Until this is configured, the Mobile tab will
  fail with an error from Supabase — the Email tab is unaffected either way.
- Confirm RLS is enabled on every table (migrations already do this, but
  verify in Table Editor before go-live).

## 2. Cloudflare Worker

```bash
cd apps/worker
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put CASHFREE_CLIENT_ID
wrangler secret put CASHFREE_CLIENT_SECRET
wrangler deploy                 # or: wrangler deploy --env production
```
Update `wrangler.toml` `[vars]` (or `[env.production].vars`) with the real
`APP_BASE_URL` and `CORS_ALLOWED_ORIGIN` before deploying to production —
CORS is intentionally locked to a single origin, not `*`, in production.

## 3. Cloudflare Pages (frontend)

```bash
cd apps/web
cp .env.example .env.production   # fill in real Supabase URL/key + API base URL + CASHFREE_MODE=production
npm run build                     # outputs dist/
```
Deploy `dist/` via the Cloudflare Pages dashboard or `wrangler pages deploy dist`.
Attach your custom domain (e.g. `app.<domain>.in`) and confirm HTTPS is enforced.

## 4. Cashfree

See `docs/CASHFREE_SETUP.md` in full. Minimum before accepting real money:
- KYC-approved live credentials
- Webhooks pointed at the deployed Worker URL
- Production domain whitelisted
- `CASHFREE_ENV=production` and live secrets set via `wrangler secret put`
  in the production environment

## 5. Post-deploy verification

- [ ] `GET /api/v1/plans` returns the seeded catalog
- [ ] Sign up with a real email, receive the sign-in link, and click it
- [ ] Upload a sample `.docx`, confirm preview/pagination/print still work
      identically to `apps/web/BASELINE_hindi-registry-tool-phase1.html`
- [ ] Trigger the print gate as a brand-new (unauthenticated) user → login
      modal appears → after login, entitlement check proceeds
- [ ] Complete one sandbox Flex purchase end-to-end, confirm exactly 25
      credits land in `credit_wallets`
- [ ] Confirm `grep` for secrets in the built `apps/web/dist` bundle is clean
      (see `docs/SECURITY.md`)

## Known gaps to close before a real launch

- No PWA icon assets yet (`apps/web/vite.config.js` references placeholder
  paths under `/icons/` — generate real 192×192 / 512×512 PNGs).
- No Playwright E2E suite yet (see `KNOWN LIMITATIONS` in the implementation
  report). Unit tests (`npm test`) cover the document engine and backend
  decision logic but do not exercise a live login/checkout flow end-to-end.
- A minimal admin portal now exists at `/admin.html` (deployed alongside the
  main app) — see `docs/MANUAL_UPI_PAYMENTS.md`. It covers reviewing manual
  UPI payment requests and ad-hoc entitlement/credit grants, but is not the
  full admin surface described in spec section 27 (no webhook-diagnostics
  view, no audit log beyond `entitlement_overrides.reason`/`created_by`).
  Set `ADMIN_EMAIL_ALLOWLIST` in `apps/worker/wrangler.toml` (or as a secret)
  before anyone can use it — every `/api/v1/admin/*` route denies by default.
- Tailwind is still loaded from the CDN in `apps/web/index.html` rather than
  compiled locally — fine for development, but spec section 3 (Frontend)
  recommends compiling it for production to avoid a runtime CDN dependency.
