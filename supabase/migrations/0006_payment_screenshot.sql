-- Optional payment-proof screenshot for manual UPI payment requests (both
-- the plan-based and per-page flows). Stored as a base64 data URL directly
-- on the row for simplicity — no Supabase Storage bucket to configure.
-- Size-capped in application code (apps/worker/src/routes/manual-payments.ts),
-- not here; this is a plain nullable text column.

alter table public.manual_payment_requests
  add column if not exists screenshot_base64 text;
