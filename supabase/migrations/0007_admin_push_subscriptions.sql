-- Web Push subscriptions for admin devices (e.g. an iPhone with the admin
-- panel added to the Home Screen). Only the Worker's service-role client
-- ever touches this table — no RLS policy grants client access.
create table if not exists public.admin_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  admin_email text,
  created_at timestamptz not null default now()
);

alter table public.admin_push_subscriptions enable row level security;
