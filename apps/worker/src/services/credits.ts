// Pure credit-ledger and document-unlock logic. Callers (routes) are
// responsible for wrapping the DB reads/writes this implies in a single
// transaction / RPC so the check-then-write is atomic in Postgres.

export type CreditGrantResult = { granted: boolean; reason?: 'already_granted' };

// Idempotent credit grant: a purchase_id can only ever grant credits once.
// `existingGrantForPurchase` is whatever the caller found when it looked up
// credit_transactions for this purchase_id (null if none).
export function planCreditGrant(purchaseId: string, existingGrantForPurchase: unknown | null): CreditGrantResult {
  if (existingGrantForPurchase) return { granted: false, reason: 'already_granted' };
  return { granted: true };
}

export type UnlockDecision =
  | { allowed: true; source: 'existing_unlock'; unlockId: string }
  | { allowed: true; source: 'flex_credit'; consumesCredit: true }
  | { allowed: true; source: 'unlimited' }
  | { allowed: false; reason: 'no_entitlement' };

export type ExistingUnlock = { id: string; client_unlock_key: string; valid_until: string } | null;

export type UnlockRequestInput = {
  now: Date;
  clientUnlockKey: string;
  existingUnlock: ExistingUnlock; // most recent unlock for this key, if any
  entitlement: {
    unlimitedDocuments: boolean;
    tier: 'business' | 'professional' | 'flex' | 'none';
    creditBalance: number;
  };
};

// Central "should this document-unlock request consume anything" decision.
// A document already unlocked within its still-valid reprint window (default
// 24h, enforced by the caller when writing valid_until) never consumes a
// second credit just because window.print() was called again.
export function decideUnlock(input: UnlockRequestInput): UnlockDecision {
  const { now, existingUnlock, entitlement } = input;

  if (existingUnlock && new Date(existingUnlock.valid_until).getTime() > now.getTime()) {
    return { allowed: true, source: 'existing_unlock', unlockId: existingUnlock.id };
  }

  if (entitlement.unlimitedDocuments) {
    return { allowed: true, source: 'unlimited' };
  }

  if (entitlement.creditBalance > 0) {
    return { allowed: true, source: 'flex_credit', consumesCredit: true };
  }

  return { allowed: false, reason: 'no_entitlement' };
}

export function unlockValidUntil(now: Date, hours = 24): Date {
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}
