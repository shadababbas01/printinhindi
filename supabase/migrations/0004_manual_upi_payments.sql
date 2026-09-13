-- Manual UPI payment requests — a stopgap purchase path for launch before (or
-- alongside) Cashfree: the customer pays a personal/business UPI QR directly
-- and submits the UTR/reference number here for an admin to review and grant
-- entitlement. This table only ever grants access after an explicit admin
-- approval (routes/admin.ts) — never automatically from user-submitted data.

create table public.manual_payment_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text, -- denormalized at submission time so admins don't need a separate auth lookup
  plan_id text not null references public.plans(id),
  amount_paise integer not null, -- copied from plans.amount_paise server-side at submission time
  utr_reference text not null,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz,
  reviewed_by uuid,
  review_note text,
  created_at timestamptz not null default now()
);
create index manual_payment_requests_status_idx on public.manual_payment_requests(status);
create index manual_payment_requests_user_id_idx on public.manual_payment_requests(user_id);

alter table public.manual_payment_requests enable row level security;

-- Users may create and read their own requests, but never approve/reject
-- their own or anyone else's — status transitions only happen via the
-- Worker's service-role client after an admin action.
create policy manual_payment_requests_select_own on public.manual_payment_requests
  for select using (auth.uid() = user_id);
create policy manual_payment_requests_insert_own on public.manual_payment_requests
  for insert with check (auth.uid() = user_id and status = 'pending');
