// Pure entitlement computation — no DB/network calls in this file so it can
// be unit-tested directly. Routes fetch the raw rows and pass them in here;
// this function is the single source of truth for "what can this user do".
//
// Priority order (spec section 17):
//   1. admin/manual override
//   2. active Business subscription
//   3. active Professional subscription
//   4. active prepaid annual entitlement
//   5. active free trial
//   6. available Flex credits
//   7. no entitlement

export type PlanRow = {
  id: string;
  unlimited_documents: boolean;
  device_limit: number;
  validity_days?: number | null;
};

export type SubscriptionRow = {
  plan_id: string;
  status: string; // 'ACTIVE' | 'ON_HOLD' | 'CANCELLED' | 'EXPIRED' | ...
  current_period_end: string | null;
};

export type PurchaseRow = {
  plan_id: string;
  status: string; // 'PAID' | ...
  paid_at: string | null;
};

export type OverrideRow = {
  plan_id: string | null;
  active_from: string;
  active_until: string | null;
};

export type TrialRow = {
  trial_started_at: string | null;
  trial_ends_at: string | null;
  trial_unlock_limit: number;
  trial_unlocks_used: number;
} | null;

export type EntitlementInput = {
  now: Date;
  plans: Record<string, PlanRow>;
  subscriptions: SubscriptionRow[];
  purchases: PurchaseRow[]; // only prepaid/annual purchases relevant here
  overrides: OverrideRow[];
  trial: TrialRow;
  creditBalance: number;
  deviceCount: number;
};

export type Entitlement = {
  tier: 'business' | 'professional' | 'trial' | 'flex' | 'none';
  status: 'active' | 'expired' | 'none';
  source: 'override' | 'subscription' | 'annual' | 'trial' | 'credits' | 'none';
  planId: string | null;
  unlimitedDocuments: boolean;
  deviceLimit: number;
  currentDeviceAllowed: boolean;
  validUntil: string | null;
  creditBalance: number;
  trial: {
    unlocksRemaining: number;
    daysRemaining: number;
  } | null;
};

function isActiveSubscription(s: SubscriptionRow, now: Date): boolean {
  if (s.status !== 'ACTIVE') return false;
  if (!s.current_period_end) return true;
  return new Date(s.current_period_end).getTime() > now.getTime();
}

function isActivePurchase(p: PurchaseRow, plan: PlanRow | undefined, now: Date, validityDays: number | undefined): boolean {
  if (p.status !== 'PAID' || !p.paid_at || !plan) return false;
  if (!validityDays) return true;
  const expiry = new Date(p.paid_at).getTime() + validityDays * 24 * 60 * 60 * 1000;
  return expiry > now.getTime();
}

function isActiveOverride(o: OverrideRow, now: Date): boolean {
  const t = now.getTime();
  if (new Date(o.active_from).getTime() > t) return false;
  if (o.active_until && new Date(o.active_until).getTime() < t) return false;
  return true;
}

function baseResult(deviceCount: number): Entitlement {
  return {
    tier: 'none',
    status: 'none',
    source: 'none',
    planId: null,
    unlimitedDocuments: false,
    deviceLimit: 1,
    currentDeviceAllowed: deviceCount < 1,
    validUntil: null,
    creditBalance: 0,
    trial: null,
  };
}

export function computeEntitlement(input: EntitlementInput): Entitlement {
  const { now, plans, subscriptions, purchases, overrides, trial, creditBalance, deviceCount } = input;

  // 1. admin/manual override
  const activeOverride = overrides.find((o) => isActiveOverride(o, now));
  if (activeOverride && activeOverride.plan_id && plans[activeOverride.plan_id]) {
    const plan = plans[activeOverride.plan_id];
    return {
      tier: plan.device_limit >= 3 ? 'business' : 'professional',
      status: 'active',
      source: 'override',
      planId: plan.id,
      unlimitedDocuments: plan.unlimited_documents,
      deviceLimit: plan.device_limit,
      currentDeviceAllowed: deviceCount <= plan.device_limit,
      validUntil: activeOverride.active_until,
      creditBalance,
      trial: null,
    };
  }

  // 2 & 3. active subscription (Business ranks above Professional if somehow both exist)
  const activeSubs = subscriptions.filter((s) => isActiveSubscription(s, now));
  const bestSub = activeSubs
    .map((s) => ({ s, plan: plans[s.plan_id] }))
    .filter((x) => x.plan)
    .sort((a, b) => b.plan.device_limit - a.plan.device_limit)[0];
  if (bestSub) {
    return {
      tier: bestSub.plan.device_limit >= 3 ? 'business' : 'professional',
      status: 'active',
      source: 'subscription',
      planId: bestSub.plan.id,
      unlimitedDocuments: bestSub.plan.unlimited_documents,
      deviceLimit: bestSub.plan.device_limit,
      currentDeviceAllowed: deviceCount <= bestSub.plan.device_limit,
      validUntil: bestSub.s.current_period_end,
      creditBalance,
      trial: null,
    };
  }

  // 4. active prepaid annual entitlement
  const activeAnnual = purchases
    .map((p) => ({ p, plan: plans[p.plan_id] }))
    .filter((x) => x.plan && isActivePurchase(x.p, x.plan, now, x.plan.validity_days ?? undefined))
    .sort((a, b) => b.plan.device_limit - a.plan.device_limit)[0];
  if (activeAnnual) {
    const validityDays = activeAnnual.plan.validity_days ?? 365;
    const validUntil = activeAnnual.p.paid_at
      ? new Date(new Date(activeAnnual.p.paid_at).getTime() + validityDays * 86400000).toISOString()
      : null;
    return {
      tier: activeAnnual.plan.device_limit >= 3 ? 'business' : 'professional',
      status: 'active',
      source: 'annual',
      planId: activeAnnual.plan.id,
      unlimitedDocuments: activeAnnual.plan.unlimited_documents,
      deviceLimit: activeAnnual.plan.device_limit,
      currentDeviceAllowed: deviceCount <= activeAnnual.plan.device_limit,
      validUntil,
      creditBalance,
      trial: null,
    };
  }

  // 5. active free trial — including a user whose trial hasn't started yet.
  // The trial row is created lazily on first unlock (spec: "trial starts on
  // first document unlock, not at account creation"), so a brand-new user
  // with no `trials` row must still be treated as trial-eligible here, or
  // decideUnlock() (which requires tier === 'trial') would reject their very
  // first Print click before the trial ever gets a chance to start.
  if (!trial || !trial.trial_started_at) {
    return {
      tier: 'trial',
      status: 'active',
      source: 'trial',
      planId: 'free_trial',
      unlimitedDocuments: false,
      deviceLimit: 1,
      currentDeviceAllowed: deviceCount <= 1,
      validUntil: null,
      creditBalance,
      trial: { unlocksRemaining: 10, daysRemaining: 7 },
    };
  }

  if (trial.trial_ends_at) {
    const trialActive =
      new Date(trial.trial_ends_at).getTime() > now.getTime() &&
      trial.trial_unlocks_used < trial.trial_unlock_limit;
    if (trialActive) {
      const daysRemaining = Math.max(
        0,
        Math.ceil((new Date(trial.trial_ends_at).getTime() - now.getTime()) / 86400000)
      );
      return {
        tier: 'trial',
        status: 'active',
        source: 'trial',
        planId: 'free_trial',
        unlimitedDocuments: false,
        deviceLimit: 1,
        currentDeviceAllowed: deviceCount <= 1,
        validUntil: trial.trial_ends_at,
        creditBalance,
        trial: {
          unlocksRemaining: trial.trial_unlock_limit - trial.trial_unlocks_used,
          daysRemaining,
        },
      };
    }
  }

  // 6. available Flex credits
  if (creditBalance > 0) {
    return {
      tier: 'flex',
      status: 'active',
      source: 'credits',
      planId: 'flex_25',
      unlimitedDocuments: false,
      deviceLimit: 1,
      currentDeviceAllowed: deviceCount <= 1,
      validUntil: null,
      creditBalance,
      trial: null,
    };
  }

  // 7. no entitlement (a started-and-exhausted/expired trial with no credits left)
  const result = baseResult(deviceCount);
  result.creditBalance = creditBalance;
  return result;
}
