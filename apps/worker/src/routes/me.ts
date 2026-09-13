import type { Env } from '../index';
import { requireUser, isResponse } from '../middleware/auth';
import { serviceClient } from '../services/supabase';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function handleMe(env: Env, request: Request): Promise<Response> {
  const user = await requireUser(env, request);
  if (isResponse(user)) return user;

  const db = serviceClient(env);
  const { data: profile } = await db.from('profiles').select('*').eq('user_id', user.id).maybeSingle();

  return json({
    id: user.id,
    email: user.email,
    profile: profile ?? null,
  });
}

export async function handleUpdateProfile(env: Env, request: Request): Promise<Response> {
  const user = await requireUser(env, request);
  if (isResponse(user)) return user;

  const body = (await request.json().catch(() => null)) as
    | { full_name?: string; phone?: string; business_name?: string; gstin?: string }
    | null;
  if (!body) return json({ error: 'INVALID_BODY' }, 400);

  const allowed = ['full_name', 'phone', 'business_name', 'gstin'] as const;
  const patch: Record<string, string> = {};
  for (const key of allowed) {
    if (typeof body[key] === 'string') patch[key] = body[key] as string;
  }

  const db = serviceClient(env);
  const { error } = await db.from('profiles').upsert({ user_id: user.id, ...patch }, { onConflict: 'user_id' });
  if (error) return json({ error: 'PROFILE_UPDATE_FAILED' }, 500);

  return json({ ok: true });
}
