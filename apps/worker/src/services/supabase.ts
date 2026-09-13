import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../index';

// Service-role client: full DB access, bypasses RLS. NEVER expose this key
// or this client to the browser — it only exists inside the Worker.
export function serviceClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Verifies the bearer token from the Authorization header against Supabase
// Auth and returns the authenticated user, or null if missing/invalid.
export async function getUserFromRequest(env: Env, request: Request) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return null;

  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}
