// Pure decision logic for how a manually-approved payment (or an ad-hoc admin
// grant) should be recorded, given a plan's billing_type. Kept separate from
// the route handler so the "what mechanism does this plan need" question is
// unit-testable without touching the database.

export type PlanForGrant = {
  billing_type: string; // 'free' | 'recurring' | 'prepaid' | 'prepaid_credits' | 'per_page'
  billing_interval?: string | null;
  validity_days?: number | null;
  included_credits?: number | null;
};

export type GrantMechanism =
  | { kind: 'override'; validityDays: number }
  | { kind: 'credits'; credits: number; validityDays: number }
  | { kind: 'unsupported' };

export function planGrantMechanism(plan: PlanForGrant): GrantMechanism {
  if (plan.billing_type === 'prepaid_credits') {
    return { kind: 'credits', credits: plan.included_credits ?? 0, validityDays: plan.validity_days ?? 90 };
  }
  if (plan.billing_type === 'prepaid') {
    return { kind: 'override', validityDays: plan.validity_days ?? 365 };
  }
  if (plan.billing_type === 'recurring') {
    return { kind: 'override', validityDays: plan.billing_interval === 'year' ? 365 : 30 };
  }
  // 'per_page' is deliberately unsupported here — it's not an entitlement
  // grant at all, it's a per-document unlock handled directly in
  // routes/admin.ts::handleApproveManualPayment (see 0005_per_page_pricing.sql).
  return { kind: 'unsupported' };
}
