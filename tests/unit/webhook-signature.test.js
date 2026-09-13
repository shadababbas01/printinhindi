import { describe, it, expect } from 'vitest';
import { verifyWebhookSignature } from '../../apps/worker/src/services/cashfree.ts';
import { createHmac } from 'node:crypto';

const SECRET = 'test-client-secret';

function sign(secret, timestamp, rawBody) {
  return createHmac('sha256', secret).update(timestamp + rawBody).digest('base64');
}

describe('verifyWebhookSignature', () => {
  it('accepts a correctly signed payload', async () => {
    const timestamp = '1757750400';
    const rawBody = JSON.stringify({ type: 'PAYMENT_SUCCESS_WEBHOOK', data: { order: { order_id: 'ord_1' } } });
    const signature = sign(SECRET, timestamp, rawBody);
    const ok = await verifyWebhookSignature(SECRET, rawBody, timestamp, signature);
    expect(ok).toBe(true);
  });

  it('rejects a tampered body even if the signature header is unchanged', async () => {
    const timestamp = '1757750400';
    const rawBody = JSON.stringify({ amount: 99 });
    const signature = sign(SECRET, timestamp, rawBody);
    const tamperedBody = JSON.stringify({ amount: 999999 });
    const ok = await verifyWebhookSignature(SECRET, tamperedBody, timestamp, signature);
    expect(ok).toBe(false);
  });

  it('rejects a signature computed with the wrong secret', async () => {
    const timestamp = '1757750400';
    const rawBody = JSON.stringify({ amount: 99 });
    const signature = sign('wrong-secret', timestamp, rawBody);
    const ok = await verifyWebhookSignature(SECRET, rawBody, timestamp, signature);
    expect(ok).toBe(false);
  });

  it('rejects a replayed signature paired with a different timestamp', async () => {
    const rawBody = JSON.stringify({ amount: 99 });
    const signature = sign(SECRET, '1757750400', rawBody);
    const ok = await verifyWebhookSignature(SECRET, rawBody, '1757750999', signature);
    expect(ok).toBe(false);
  });
});
