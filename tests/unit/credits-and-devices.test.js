import { describe, it, expect } from 'vitest';
import { decideUnlock, planCreditGrant, unlockValidUntil } from '../../apps/worker/src/services/credits.ts';
import { decideDeviceRegistration } from '../../apps/worker/src/services/devices.ts';

const NOW = new Date('2026-09-13T12:00:00Z');

describe('decideUnlock — document unlock is not the same as a confirmed print', () => {
  it('reprinting within the 24h window consumes nothing again', () => {
    const decision = decideUnlock({
      now: NOW,
      clientUnlockKey: 'sess-1',
      existingUnlock: { id: 'u1', client_unlock_key: 'sess-1', valid_until: '2026-09-13T18:00:00Z' },
      entitlement: { unlimitedDocuments: false, tier: 'flex', creditBalance: 3 },
    });
    expect(decision).toEqual({ allowed: true, source: 'existing_unlock', unlockId: 'u1' });
  });

  it('an unlock past its valid_until requires a fresh decision (not free)', () => {
    const decision = decideUnlock({
      now: NOW,
      clientUnlockKey: 'sess-1',
      existingUnlock: { id: 'u1', client_unlock_key: 'sess-1', valid_until: '2026-09-12T00:00:00Z' },
      entitlement: { unlimitedDocuments: false, tier: 'flex', creditBalance: 3 },
    });
    expect(decision.source).not.toBe('existing_unlock');
  });

  it('unlimited-plan users never consume credit units', () => {
    const decision = decideUnlock({
      now: NOW,
      clientUnlockKey: 'sess-2',
      existingUnlock: null,
      entitlement: { unlimitedDocuments: true, tier: 'professional', creditBalance: 0 },
    });
    expect(decision).toEqual({ allowed: true, source: 'unlimited' });
  });

  it('flex user with credits consumes exactly one credit', () => {
    const decision = decideUnlock({
      now: NOW,
      clientUnlockKey: 'sess-4',
      existingUnlock: null,
      entitlement: { unlimitedDocuments: false, tier: 'flex', creditBalance: 1 },
    });
    expect(decision).toEqual({ allowed: true, source: 'flex_credit', consumesCredit: true });
  });

  it('rejects unlock when there is no entitlement and no credits — no free trial to fall back on', () => {
    const decision = decideUnlock({
      now: NOW,
      clientUnlockKey: 'sess-5',
      existingUnlock: null,
      entitlement: { unlimitedDocuments: false, tier: 'none', creditBalance: 0 },
    });
    expect(decision).toEqual({ allowed: false, reason: 'no_entitlement' });
  });

  it('unlockValidUntil defaults to a 24 hour window', () => {
    const until = unlockValidUntil(NOW);
    expect(until.getTime() - NOW.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe('planCreditGrant — webhook idempotency for credit packs', () => {
  it('grants credits the first time a purchase is seen', () => {
    expect(planCreditGrant('purchase-1', null)).toEqual({ granted: true });
  });

  it('refuses a second grant for the same purchase_id (duplicate webhook)', () => {
    expect(planCreditGrant('purchase-1', { id: 'existing-tx' })).toEqual({
      granted: false,
      reason: 'already_granted',
    });
  });
});

describe('decideDeviceRegistration', () => {
  it('allows registering a brand-new device under the limit', () => {
    const r = decideDeviceRegistration('device-b', [{ installation_id: 'device-a', revoked_at: null }], 2);
    expect(r).toEqual({ allowed: true, alreadyRegistered: false });
  });

  it('is idempotent for a device that is already registered', () => {
    const r = decideDeviceRegistration('device-a', [{ installation_id: 'device-a', revoked_at: null }], 1);
    expect(r).toEqual({ allowed: true, alreadyRegistered: true });
  });

  it('blocks a new device once the plan device_limit is reached', () => {
    const r = decideDeviceRegistration(
      'device-c',
      [
        { installation_id: 'device-a', revoked_at: null },
        { installation_id: 'device-b', revoked_at: null },
      ],
      2
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('DEVICE_LIMIT_REACHED');
    expect(r.activeDevices).toHaveLength(2);
  });

  it('does not count a revoked device against the limit', () => {
    const r = decideDeviceRegistration(
      'device-c',
      [
        { installation_id: 'device-a', revoked_at: '2026-01-01T00:00:00Z' },
        { installation_id: 'device-b', revoked_at: null },
      ],
      2
    );
    expect(r.allowed).toBe(true);
  });
});
