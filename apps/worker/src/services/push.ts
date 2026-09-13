import type { Env } from '../index';
import { serviceClient } from './supabase';

// Web Push (RFC 8030/8291/8292) without an encrypted payload — every push
// sent here is a bare "wake up and check" ping (TTL only, no body), so there
// is no aes128gcm payload encryption to implement. The service worker just
// shows a fixed notification text and the admin opens the panel to see
// what's actually pending. This keeps the whole thing to a VAPID JWT
// (signed with native WebCrypto, no npm dependency) instead of a full
// web-push client library, which doesn't bundle cleanly into a Worker.

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(b64url.length + ((4 - (b64url.length % 4)) % 4), '=');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// VAPID keys (from `npx web-push generate-vapid-keys`) are raw EC P-256
// points, not JWK/PEM — the public key is the uncompressed SEC1 point
// (0x04 || x || y, 65 bytes) and the private key is the raw 32-byte scalar
// d. WebCrypto's importKey('jwk', ...) wants those same numbers as
// individually base64url-encoded JWK members, so we just split the bytes.
async function importVapidPrivateKey(publicKeyB64url: string, privateKeyB64url: string): Promise<CryptoKey> {
  const pub = base64UrlToBytes(publicKeyB64url);
  const x = pub.slice(1, 33);
  const y = pub.slice(33, 65);
  const d = base64UrlToBytes(privateKeyB64url);
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: bytesToBase64Url(x),
    y: bytesToBase64Url(y),
    d: bytesToBase64Url(d),
    ext: true,
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

async function vapidAuthHeader(env: Env, audience: string): Promise<string> {
  const header = { typ: 'JWT', alg: 'ES256' };
  const claims = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: env.VAPID_SUBJECT,
  };
  const enc = (obj: unknown) => bytesToBase64Url(new TextEncoder().encode(JSON.stringify(obj)));
  const unsigned = `${enc(header)}.${enc(claims)}`;

  const key = await importVapidPrivateKey(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${bytesToBase64Url(new Uint8Array(signature))}`;

  return `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`;
}

interface PushSubscriptionRow {
  id: string;
  endpoint: string;
}

async function sendPush(env: Env, endpoint: string): Promise<{ ok: boolean; expired: boolean }> {
  const audience = new URL(endpoint).origin;
  const authorization = await vapidAuthHeader(env, audience);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: authorization, TTL: '86400', 'Content-Length': '0' },
  });
  // 404/410 means the browser dropped this subscription (e.g. uninstalled,
  // permission revoked) — the caller should delete the row so it stops
  // trying forever.
  return { ok: res.ok, expired: res.status === 404 || res.status === 410 };
}

// Best-effort fan-out to every admin device that's opted in. Never throws —
// a push provider being down must not block the payment submission that
// triggered it.
export async function notifyAdminsOfPendingPayment(env: Env): Promise<void> {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return; // not configured yet

  try {
    const db = serviceClient(env);
    const { data: subs } = await db.from('admin_push_subscriptions').select('id, endpoint');
    if (!subs?.length) return;

    await Promise.all(
      (subs as PushSubscriptionRow[]).map(async (sub) => {
        try {
          const result = await sendPush(env, sub.endpoint);
          if (result.expired) {
            await db.from('admin_push_subscriptions').delete().eq('id', sub.id);
          }
        } catch (err: any) {
          console.error('Push send failed:', err?.message);
        }
      })
    );
  } catch (err: any) {
    console.error('notifyAdminsOfPendingPayment failed:', err?.message);
  }
}
