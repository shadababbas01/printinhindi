import type { Env } from '../index';
import { getUserFromRequest } from '../services/supabase';

export type AuthedUser = { id: string; email: string | null };

// Every route under /api/v1 except /plans and /webhooks/* must call this and
// bail out with 401 if it returns null. The Supabase JWT is verified
// server-side on every request — the frontend's local session state is never
// trusted for authorization decisions.
export async function requireUser(env: Env, request: Request): Promise<AuthedUser | Response> {
  const user = await getUserFromRequest(env, request);
  if (!user) {
    return new Response(JSON.stringify({ error: 'UNAUTHENTICATED' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return { id: user.id, email: user.email ?? null };
}

export function isResponse(x: unknown): x is Response {
  return x instanceof Response;
}

// Minimal admin allow-list check. Extend to a proper `admins` table/claim
// before shipping the admin portal (spec section 27) — this is intentionally
// conservative (deny by default).
export function isAdmin(env: Env, user: AuthedUser): boolean {
  const allowList = (env.ADMIN_EMAIL_ALLOWLIST || '').split(',').map((s) => s.trim().toLowerCase());
  return !!user.email && allowList.includes(user.email.toLowerCase());
}
