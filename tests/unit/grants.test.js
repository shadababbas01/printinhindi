import { describe, it, expect } from 'vitest';
import { planGrantMechanism } from '../../apps/worker/src/services/grants.ts';

describe('planGrantMechanism — how a manual/admin grant is recorded per plan type', () => {
  it('a credit pack grants credits with its own validity window', () => {
    expect(planGrantMechanism({ billing_type: 'prepaid_credits', included_credits: 25, validity_days: 90 })).toEqual({
      kind: 'credits',
      credits: 25,
      validityDays: 90,
    });
  });

  it('a prepaid annual plan grants an entitlement override for its validity_days', () => {
    expect(planGrantMechanism({ billing_type: 'prepaid', validity_days: 365 })).toEqual({
      kind: 'override',
      validityDays: 365,
    });
  });

  it('a recurring monthly plan grants a 30-day override', () => {
    expect(planGrantMechanism({ billing_type: 'recurring', billing_interval: 'month' })).toEqual({
      kind: 'override',
      validityDays: 30,
    });
  });

  it('a recurring annual plan grants a 365-day override', () => {
    expect(planGrantMechanism({ billing_type: 'recurring', billing_interval: 'year' })).toEqual({
      kind: 'override',
      validityDays: 365,
    });
  });

  it('the free trial plan cannot be manually granted this way', () => {
    expect(planGrantMechanism({ billing_type: 'free' })).toEqual({ kind: 'unsupported' });
  });

  it('per-page pricing cannot be granted through the generic plan-grant path (it unlocks one document instead)', () => {
    expect(planGrantMechanism({ billing_type: 'per_page' })).toEqual({ kind: 'unsupported' });
  });
});
