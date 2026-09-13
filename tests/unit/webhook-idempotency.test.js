// The real recordEventOnce() (apps/worker/src/routes/webhooks.ts) relies on
// Supabase/Postgres and can't run without a live DB, so this test isolates
// the CONTRACT it depends on: a unique (provider, event_key) constraint that
// makes a second insert for the same key fail, which the handler treats as
// "already processed, do not re-grant". This is exactly the mechanism
// 0001_init.sql's `unique(provider, event_key)` constraint enforces.
import { describe, it, expect } from 'vitest';

class FakeWebhookEventsTable {
  constructor() {
    this.seen = new Set();
  }
  // Mirrors: insert into payment_webhook_events(...) with a unique(provider, event_key) constraint
  insertOnce(provider, eventKey) {
    const key = `${provider}:${eventKey}`;
    if (this.seen.has(key)) {
      return { error: { code: '23505' } }; // Postgres unique_violation
    }
    this.seen.add(key);
    return { error: null };
  }
}

function recordEventOnce(table, provider, eventKey) {
  const { error } = table.insertOnce(provider, eventKey);
  if (error) {
    if (error.code === '23505') return false; // duplicate
    throw new Error('unexpected DB error');
  }
  return true;
}

describe('webhook idempotency contract', () => {
  it('processes the first delivery of an event', () => {
    const table = new FakeWebhookEventsTable();
    expect(recordEventOnce(table, 'cashfree', 'payment_cf_123')).toBe(true);
  });

  it('treats a redelivered event (same event_key) as a duplicate — no reprocessing', () => {
    const table = new FakeWebhookEventsTable();
    expect(recordEventOnce(table, 'cashfree', 'payment_cf_123')).toBe(true);
    expect(recordEventOnce(table, 'cashfree', 'payment_cf_123')).toBe(false);
    expect(recordEventOnce(table, 'cashfree', 'payment_cf_123')).toBe(false);
  });

  it('a duplicate Flex payment webhook must not grant credits twice', () => {
    const table = new FakeWebhookEventsTable();
    let creditsGranted = 0;
    function handleFlexPayment(eventKey) {
      if (!recordEventOnce(table, 'cashfree', eventKey)) return; // duplicate — do nothing
      creditsGranted += 25;
    }
    handleFlexPayment('payment_cf_555');
    handleFlexPayment('payment_cf_555'); // Cashfree redelivers the same webhook
    handleFlexPayment('payment_cf_555');
    expect(creditsGranted).toBe(25);
  });

  it('distinct events (different event_key) are each processed independently', () => {
    const table = new FakeWebhookEventsTable();
    expect(recordEventOnce(table, 'cashfree', 'payment_cf_1')).toBe(true);
    expect(recordEventOnce(table, 'cashfree', 'payment_cf_2')).toBe(true);
  });
});
