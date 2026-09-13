-- Atomic counter helpers so concurrent requests (e.g. a double-click, or a
-- retpercentagey after a network blip) can't race a read-modify-write on the
-- trial unlock counter or credit wallet balance. security definer so the
-- Worker's service-role client can call them; not exposed to end users via RLS.

create or replace function public.increment_trial_unlocks(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.trials (user_id, trial_started_at, trial_ends_at, trial_unlocks_used)
  values (p_user_id, now(), now() + interval '7 days', 1)
  on conflict (user_id) do update
    set trial_unlocks_used = public.trials.trial_unlocks_used + 1,
        updated_at = now();
end;
$$;

create or replace function public.decrement_wallet_balance(p_user_id uuid, p_amount integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.credit_wallets (user_id, balance)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  update public.credit_wallets
  set balance = greatest(0, balance - p_amount),
      updated_at = now()
  where user_id = p_user_id;
end;
$$;

create or replace function public.increment_wallet_balance(p_user_id uuid, p_amount integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.credit_wallets (user_id, balance)
  values (p_user_id, p_amount)
  on conflict (user_id) do update
    set balance = public.credit_wallets.balance + p_amount,
        updated_at = now();
end;
$$;

revoke execute on function public.increment_trial_unlocks(uuid) from anon, authenticated;
revoke execute on function public.decrement_wallet_balance(uuid, integer) from anon, authenticated;
revoke execute on function public.increment_wallet_balance(uuid, integer) from anon, authenticated;
