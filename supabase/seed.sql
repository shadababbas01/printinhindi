-- Seed the plan catalog. Prices are in paise (INR * 100). This is the ONLY
-- place plan prices are defined — the Worker looks these up by planId and
-- never trusts an amount sent from the browser.

insert into public.plans (id, name, description, amount_paise, billing_type, billing_interval, validity_days, included_credits, unlimited_documents, device_limit, sort_order)
values
  ('free_trial', 'Free Trial', '7 days or 10 document unlocks, whichever comes first', 0, 'free', null, 7, 10, false, 1, 0),
  ('flex_25', 'Flex Pack', '25 document unlocks, valid 90 days, 24h reprint window per unlock', 9900, 'prepaid_credits', null, 90, 25, false, 1, 1),
  ('professional_monthly', 'Professional Monthly', 'Unlimited documents, 1 active device', 34900, 'recurring', 'month', null, null, true, 1, 2),
  ('professional_annual', 'Professional Annual', 'Unlimited documents, 1 active device, 365-day prepaid', 299900, 'prepaid', null, 365, null, true, 1, 3),
  ('business_monthly', 'Business Monthly', 'Unlimited documents, 3 active devices', 79900, 'recurring', 'month', null, null, true, 3, 4),
  ('business_annual', 'Business Annual', 'Unlimited documents, 3 active devices, 365-day prepaid', 699900, 'prepaid', null, 365, null, true, 3, 5),
  -- amount_paise here is the PRICE PER PAGE (₹10), not a flat total — the
  -- actual charge is pages × amount_paise, computed server-side in
  -- apps/worker/src/routes/manual-payments.ts::handleCreatePagePayment.
  ('per_page_print', 'Per-Page Print', 'Pay only for the pages you print — ₹10/page, no subscription or credits to track', 1000, 'per_page', null, null, null, false, 1, 6)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  amount_paise = excluded.amount_paise,
  billing_type = excluded.billing_type,
  billing_interval = excluded.billing_interval,
  validity_days = excluded.validity_days,
  included_credits = excluded.included_credits,
  unlimited_documents = excluded.unlimited_documents,
  device_limit = excluded.device_limit,
  sort_order = excluded.sort_order,
  updated_at = now();
