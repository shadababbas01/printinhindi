-- Hindi Registry Print Tool — monetization schema (initial migration)
-- Registry DOCUMENT CONTENT is never stored here. This schema only holds
-- account, billing, entitlement and device-licensing metadata.

create extension if not exists pgcrypto;

-- 11.1 profiles
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  business_name text,
  gstin text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 11.2 plans (server-side price/entitlement source of truth)
create table public.plans (
  id text primary key,
  name text not null,
  description text,
  amount_paise integer not null,
  currency text not null default 'INR',
  billing_type text not null check (billing_type in ('free', 'recurring', 'prepaid', 'prepaid_credits')),
  billing_interval text,               -- 'month' for recurring plans, else null
  validity_days integer,               -- for prepaid annual entitlements
  included_credits integer,            -- for prepaid_credits packs
  unlimited_documents boolean not null default false,
  device_limit integer not null default 1,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 11.3 subscriptions (Cashfree recurring plans)
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null references public.plans(id),
  provider text not null default 'cashfree',
  provider_subscription_id text unique,
  provider_reference_id text,
  status text not null, -- INITIALIZED | ACTIVE | ON_HOLD | CANCELLED | EXPIRED (mirror Cashfree's actual values)
  starts_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_at timestamptz,
  raw_provider_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index subscriptions_user_id_idx on public.subscriptions(user_id);
create index subscriptions_status_idx on public.subscriptions(status);

-- 11.4 purchases (one-time: Flex pack, annual plans)
create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null references public.plans(id),
  provider text not null default 'cashfree',
  provider_order_id text unique not null,
  provider_payment_id text,
  amount_paise integer not null,
  currency text not null default 'INR',
  status text not null, -- PENDING | PAID | FAILED | EXPIRED | REFUNDED
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index purchases_user_id_idx on public.purchases(user_id);

-- 11.5 credit_wallets
create table public.credit_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 0,
  updated_at timestamptz not null default now()
);

-- 11.6 credit_transactions (append-only ledger; wallet balance is derived/cached)
create table public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta integer not null,
  reason text not null, -- 'flex_purchase' | 'document_unlock' | 'admin_grant' | 'admin_revoke' | 'refund_reversal'
  purchase_id uuid references public.purchases(id),
  unlock_id uuid,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index credit_transactions_user_id_idx on public.credit_transactions(user_id);

-- 11.7 document_unlocks — NEVER store document content, only an opaque session key
create table public.document_unlocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_unlock_key text, -- random opaque id generated client-side, NOT derived from document content
  source text not null,   -- 'trial' | 'flex_credit' | 'admin_override'
  unlocked_at timestamptz not null default now(),
  valid_until timestamptz not null,
  created_at timestamptz not null default now()
);
create index document_unlocks_user_id_idx on public.document_unlocks(user_id);
create unique index document_unlocks_active_key_idx on public.document_unlocks(user_id, client_unlock_key)
  where client_unlock_key is not null;

-- 11.8 devices
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  installation_id text not null,
  display_name text,
  user_agent text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique(user_id, installation_id)
);
create index devices_user_id_idx on public.devices(user_id);

-- 11.9 payment_webhook_events (idempotency + audit)
create table public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_key text not null, -- Cashfree event id, or sha256(raw_body) fallback
  event_type text,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text,
  unique(provider, event_key)
);

-- 11.10 entitlement_overrides (support/admin manual grants)
create table public.entitlement_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text references public.plans(id),
  active_from timestamptz not null,
  active_until timestamptz,
  reason text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index entitlement_overrides_user_id_idx on public.entitlement_overrides(user_id);

-- Free trial state (one row per user, created lazily on first unlock attempt)
create table public.trials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  trial_unlock_limit integer not null default 10,
  trial_unlocks_used integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at maintenance
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.plans for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.subscriptions for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.purchases for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.credit_wallets for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.trials for each row execute function public.set_updated_at();
