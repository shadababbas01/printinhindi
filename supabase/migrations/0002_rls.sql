-- Row Level Security. Users may READ their own billing/device/unlock rows.
-- No table here grants users direct INSERT/UPDATE on payment/subscription
-- status, credit balances, or entitlement fields — those are only ever
-- written by the Worker using the Supabase service-role key, which bypasses
-- RLS entirely and is NEVER present in the browser.

alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.purchases enable row level security;
alter table public.credit_wallets enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.document_unlocks enable row level security;
alter table public.devices enable row level security;
alter table public.payment_webhook_events enable row level security;
alter table public.entitlement_overrides enable row level security;
alter table public.trials enable row level security;

-- profiles: user can read/update only their own row (no service-role-only fields here today)
create policy profiles_select_own on public.profiles for select using (auth.uid() = user_id);
create policy profiles_update_own on public.profiles for update using (auth.uid() = user_id);
create policy profiles_insert_own on public.profiles for insert with check (auth.uid() = user_id);

-- plans: public catalog, readable by anyone signed in (prices are still re-verified server-side on every purchase)
create policy plans_select_all on public.plans for select using (is_active = true);

-- subscriptions/purchases/credit_wallets/credit_transactions/document_unlocks/devices/trials:
-- read-only for the owning user; all writes happen via the Worker's service-role client.
create policy subscriptions_select_own on public.subscriptions for select using (auth.uid() = user_id);
create policy purchases_select_own on public.purchases for select using (auth.uid() = user_id);
create policy credit_wallets_select_own on public.credit_wallets for select using (auth.uid() = user_id);
create policy credit_transactions_select_own on public.credit_transactions for select using (auth.uid() = user_id);
create policy document_unlocks_select_own on public.document_unlocks for select using (auth.uid() = user_id);
create policy devices_select_own on public.devices for select using (auth.uid() = user_id);
create policy trials_select_own on public.trials for select using (auth.uid() = user_id);

-- payment_webhook_events / entitlement_overrides: no user-facing policy at all —
-- these are only ever read/written by the Worker's service-role client (RLS
-- with zero policies = zero access for anon/authenticated roles, by design).

-- No insert/update/delete policies are defined for subscriptions, purchases,
-- credit_wallets, credit_transactions, document_unlocks, devices, or trials
-- under the authenticated/anon roles — meaning users cannot mutate their own
-- billing/entitlement/device state directly, even via a crafted client request.
-- The Worker's service-role key is the only key that can write these tables.
