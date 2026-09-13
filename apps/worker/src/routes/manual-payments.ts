import type { Env } from '../index';
import { requireUser, isResponse } from '../middleware/auth';
import { serviceClient } from '../services/supabase';
import { notifyAdminsOfPendingPayment } from '../services/push';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Screenshots are optional payment-proof, stored inline as a base64 data
// URL (no Storage bucket to configure). Capped well below Postgres's own
// limits purely to keep rows small — ~700KB of base64 is a ~500KB image,
// plenty for a UPI app's payment-success screen.
const MAX_SCREENSHOT_BASE64_LENGTH = 700_000;

function validateScreenshot(screenshotBase64: unknown): string | null | undefined {
  if (screenshotBase64 == null) return null;
  if (typeof screenshotBase64 !== 'string' || !screenshotBase64.startsWith('data:image/')) return undefined;
  if (screenshotBase64.length > MAX_SCREENSHOT_BASE64_LENGTH) return undefined;
  return screenshotBase64;
}

// A stopgap purchase path (spec-adjacent, not in the original Cashfree spec):
// the customer pays a UPI QR directly and submits the reference number (and
// optionally a screenshot) here. This NEVER grants entitlement by itself —
// it only creates a 'pending' row for an admin to review in routes/admin.ts.
// Same trust boundary as the Cashfree webhook: user-submitted data alone
// never mutates paid status.
export async function handleCreateManualPayment(env: Env, request: Request): Promise<Response> {
  const user = await requireUser(env, request);
  if (isResponse(user)) return user;

  const body = (await request.json().catch(() => null)) as
    | { planId?: string; utrReference?: string; note?: string; screenshotBase64?: string }
    | null;
  if (!body?.planId || !body?.utrReference?.trim()) return json({ error: 'INVALID_BODY' }, 400);

  const screenshot = validateScreenshot(body.screenshotBase64);
  if (screenshot === undefined) return json({ error: 'INVALID_SCREENSHOT' }, 400);

  const db = serviceClient(env);
  const { data: plan } = await db.from('plans').select('*').eq('id', body.planId).eq('is_active', true).maybeSingle();
  if (!plan) return json({ error: 'UNKNOWN_PLAN' }, 400);
  if (plan.billing_type === 'free') return json({ error: 'PLAN_NOT_PURCHASABLE' }, 400);

  const { data: inserted, error } = await db
    .from('manual_payment_requests')
    .insert({
      user_id: user.id,
      user_email: user.email,
      plan_id: plan.id,
      amount_paise: plan.amount_paise,
      utr_reference: body.utrReference.trim().slice(0, 200),
      note: body.note?.trim().slice(0, 500) || null,
      screenshot_base64: screenshot,
    })
    .select('id, status, created_at')
    .single();
  if (error) return json({ error: 'REQUEST_RECORD_FAILED' }, 500);

  await notifyAdminsOfPendingPayment(env);
  return json({ request: inserted });
}

// The simple "pay per page" path: pays for and unlocks exactly ONE
// already-loaded document session (clientUnlockKey), priced at
// plans.amount_paise (id='per_page_print') × pageCount. Like the plan-based
// path above, this only ever creates a 'pending' row — an admin approval
// (routes/admin.ts) is what actually unlocks the document. The frontend
// polls GET /api/v1/manual-payments/:id to notice the approval and continue
// printing automatically.
export async function handleCreatePagePayment(env: Env, request: Request): Promise<Response> {
  const user = await requireUser(env, request);
  if (isResponse(user)) return user;

  const body = (await request.json().catch(() => null)) as
    | { clientUnlockKey?: string; pageCount?: number; utrReference?: string; note?: string; screenshotBase64?: string }
    | null;
  if (
    !body?.clientUnlockKey ||
    !Number.isInteger(body.pageCount) ||
    body.pageCount! < 1 ||
    !body.utrReference?.trim()
  ) {
    return json({ error: 'INVALID_BODY' }, 400);
  }

  const screenshot = validateScreenshot(body.screenshotBase64);
  if (screenshot === undefined) return json({ error: 'INVALID_SCREENSHOT' }, 400);

  const db = serviceClient(env);
  const { data: plan } = await db.from('plans').select('*').eq('id', 'per_page_print').eq('is_active', true).maybeSingle();
  if (!plan) return json({ error: 'PER_PAGE_PRICING_NOT_CONFIGURED' }, 400);

  const amountPaise = plan.amount_paise * body.pageCount!;

  const { data: inserted, error } = await db
    .from('manual_payment_requests')
    .insert({
      user_id: user.id,
      user_email: user.email,
      plan_id: plan.id,
      amount_paise: amountPaise,
      client_unlock_key: body.clientUnlockKey,
      page_count: body.pageCount,
      utr_reference: body.utrReference.trim().slice(0, 200),
      note: body.note?.trim().slice(0, 500) || null,
      screenshot_base64: screenshot,
    })
    .select('id, status, created_at')
    .single();
  if (error) return json({ error: 'REQUEST_RECORD_FAILED' }, 500);

  await notifyAdminsOfPendingPayment(env);
  return json({ request: inserted, amountPaise });
}

export async function handleListMyManualPayments(env: Env, request: Request): Promise<Response> {
  const user = await requireUser(env, request);
  if (isResponse(user)) return user;

  const db = serviceClient(env);
  const { data } = await db
    .from('manual_payment_requests')
    .select('id, plan_id, amount_paise, status, utr_reference, note, review_note, created_at, reviewed_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  return json({ requests: data ?? [] });
}

// Used by the frontend to poll a single submitted request's status (pending
// → approved/rejected) so it can auto-continue once an admin reviews it,
// instead of the user needing to come back and check manually.
export async function handleGetMyManualPayment(env: Env, request: Request, requestId: string): Promise<Response> {
  const user = await requireUser(env, request);
  if (isResponse(user)) return user;

  const db = serviceClient(env);
  const { data } = await db
    .from('manual_payment_requests')
    .select('id, status, review_note, reviewed_at')
    .eq('id', requestId)
    .eq('user_id', user.id) // never let a user poll someone else's request
    .maybeSingle();
  if (!data) return json({ error: 'NOT_FOUND' }, 404);

  return json({ request: data });
}
