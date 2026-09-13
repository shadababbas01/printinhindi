-- Simple pay-per-page pricing: a fixed price PER PAGE (see plans.id =
-- 'per_page_print', seeded in supabase/seed.sql). This is deliberately
-- separate from the existing prepaid/prepaid_credits/recurring plans so it
-- can never be accidentally granted through the generic plan-grant path
-- (see apps/worker/src/services/grants.ts::planGrantMechanism, which
-- returns 'unsupported' for billing_type = 'per_page').
--
-- NOTE: the per-page payment flow is currently entirely frontend-only and
-- self-confirmed (apps/web/src/billing/local-page-unlock.js) — there is no
-- backend verification of payment for it. This plan row only exists so the
-- price stays configurable server-side rather than hardcoded in the
-- frontend; the `client_unlock_key`/`page_count` columns below are unused
-- leftovers from an earlier admin-reviewed version of this flow and are
-- harmless to keep (nullable, nothing writes to them currently).

alter table public.plans drop constraint if exists plans_billing_type_check;
alter table public.plans add constraint plans_billing_type_check
  check (billing_type in ('free', 'recurring', 'prepaid', 'prepaid_credits', 'per_page'));

alter table public.manual_payment_requests
  add column if not exists client_unlock_key text,
  add column if not exists page_count integer;
