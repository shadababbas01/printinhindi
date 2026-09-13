import { describe, it, expect } from 'vitest';
import { computeEntitlement } from '../../apps/worker/src/services/entitlement.ts';

const NOW = new Date('2026-09-13T00:00:00Z');

const PLANS = {
  professional_monthly: { id: 'professional_monthly', unlimited_documents: true, device_limit: 1 },
  business_monthly: { id: 'business_monthly', unlimited_documents: true, device_limit: 3 },
  professional_annual: { id: 'professional_annual', unlimited_documents: true, device_limit: 1, validity_days: 365 },
  flex_25: { id: 'flex_25', unlimited_documents: false, device_limit: 1 },
};

function baseInput(overrides = {}) {
  return {
    now: NOW,
    plans: PLANS,
    subscriptions: [],
    purchases: [],
    overrides: [],
    trial: null,
    creditBalance: 0,
    deviceCount: 0,
    ...overrides,
  };
}

describe('computeEntitlement priority order', () => {
  it('returns none only once a trial has actually started and been exhausted/expired', () => {
    const r = computeEntitlement(
      baseInput({
        trial: {
          trial_started_at: '2026-08-01T00:00:00Z',
          trial_ends_at: '2026-08-08T00:00:00Z', // expired relative to NOW
          trial_unlock_limit: 10,
          trial_unlocks_used: 2,
        },
      })
    );
    expect(r.tier).toBe('none');
    expect(r.status).toBe('none');
  });

  it('a brand-new user (no trial row yet) is trial-eligible, not "none" — otherwise their first Print click would be rejected before the trial can ever start', () => {
    const r = computeEntitlement(baseInput());
    expect(r.tier).toBe('trial');
    expect(r.status).toBe('active');
    expect(r.trial).toEqual({ unlocksRemaining: 10, daysRemaining: 7 });
  });

  it('grants flex tier when credits are available and the trial is already used up (not merely unstarted)', () => {
    const r = computeEntitlement(
      baseInput({
        creditBalance: 12,
        trial: {
          trial_started_at: '2026-09-01T00:00:00Z',
          trial_ends_at: '2026-09-08T00:00:00Z', // expired relative to NOW
          trial_unlock_limit: 10,
          trial_unlocks_used: 10, // also exhausted
        },
      })
    );
    expect(r.tier).toBe('flex');
    expect(r.source).toBe('credits');
    expect(r.unlimitedDocuments).toBe(false);
  });

  it('an unstarted trial outranks purchased Flex credits — spend the free allocation first', () => {
    const r = computeEntitlement(baseInput({ creditBalance: 12 }));
    expect(r.tier).toBe('trial');
    expect(r.creditBalance).toBe(12); // credits are preserved, just not the active tier yet
  });

  it('grants trial tier over flex credits (trial ranks higher in priority)', () => {
    const r = computeEntitlement(
      baseInput({
        creditBalance: 5,
        trial: {
          trial_started_at: '2026-09-10T00:00:00Z',
          trial_ends_at: '2026-09-17T00:00:00Z',
          trial_unlock_limit: 10,
          trial_unlocks_used: 3,
        },
      })
    );
    expect(r.tier).toBe('trial');
    expect(r.trial.unlocksRemaining).toBe(7);
  });

  it('does not grant an expired trial even if unlocks remain', () => {
    const r = computeEntitlement(
      baseInput({
        trial: {
          trial_started_at: '2026-08-01T00:00:00Z',
          trial_ends_at: '2026-08-08T00:00:00Z', // in the past relative to NOW
          trial_unlock_limit: 10,
          trial_unlocks_used: 2,
        },
      })
    );
    expect(r.tier).not.toBe('trial');
  });

  it('does not grant a trial that exhausted its unlock count even if time remains', () => {
    const r = computeEntitlement(
      baseInput({
        trial: {
          trial_started_at: '2026-09-10T00:00:00Z',
          trial_ends_at: '2026-09-20T00:00:00Z',
          trial_unlock_limit: 10,
          trial_unlocks_used: 10,
        },
      })
    );
    expect(r.tier).not.toBe('trial');
  });

  it('grants annual entitlement over trial/credits', () => {
    const r = computeEntitlement(
      baseInput({
        creditBalance: 5,
        purchases: [{ plan_id: 'professional_annual', status: 'PAID', paid_at: '2026-01-01T00:00:00Z' }],
      })
    );
    expect(r.tier).toBe('professional');
    expect(r.source).toBe('annual');
    expect(r.unlimitedDocuments).toBe(true);
  });

  it('expires the annual entitlement after validity_days', () => {
    const r = computeEntitlement(
      baseInput({
        purchases: [{ plan_id: 'professional_annual', status: 'PAID', paid_at: '2024-01-01T00:00:00Z' }],
      })
    );
    expect(r.source).not.toBe('annual');
  });

  it('prefers an active subscription over an annual purchase', () => {
    const r = computeEntitlement(
      baseInput({
        purchases: [{ plan_id: 'professional_annual', status: 'PAID', paid_at: '2026-01-01T00:00:00Z' }],
        subscriptions: [{ plan_id: 'business_monthly', status: 'ACTIVE', current_period_end: '2026-10-01T00:00:00Z' }],
      })
    );
    expect(r.source).toBe('subscription');
    expect(r.tier).toBe('business');
  });

  it('prefers Business over Professional when both subscriptions are somehow active', () => {
    const r = computeEntitlement(
      baseInput({
        subscriptions: [
          { plan_id: 'professional_monthly', status: 'ACTIVE', current_period_end: '2026-10-01T00:00:00Z' },
          { plan_id: 'business_monthly', status: 'ACTIVE', current_period_end: '2026-10-01T00:00:00Z' },
        ],
      })
    );
    expect(r.tier).toBe('business');
  });

  it('ignores a CANCELLED subscription', () => {
    const r = computeEntitlement(
      baseInput({
        subscriptions: [{ plan_id: 'professional_monthly', status: 'CANCELLED', current_period_end: '2026-10-01T00:00:00Z' }],
      })
    );
    expect(r.tier).not.toBe('professional');
  });

  it('admin override outranks everything, including an active subscription', () => {
    const r = computeEntitlement(
      baseInput({
        subscriptions: [{ plan_id: 'professional_monthly', status: 'ACTIVE', current_period_end: '2026-10-01T00:00:00Z' }],
        overrides: [{ plan_id: 'business_monthly', active_from: '2026-09-01T00:00:00Z', active_until: '2026-12-01T00:00:00Z' }],
      })
    );
    expect(r.source).toBe('override');
    expect(r.tier).toBe('business');
  });

  it('computes currentDeviceAllowed against the plan device_limit', () => {
    const r = computeEntitlement(
      baseInput({
        subscriptions: [{ plan_id: 'professional_monthly', status: 'ACTIVE', current_period_end: '2026-10-01T00:00:00Z' }],
        deviceCount: 2,
      })
    );
    expect(r.deviceLimit).toBe(1);
    expect(r.currentDeviceAllowed).toBe(false);
  });
});
