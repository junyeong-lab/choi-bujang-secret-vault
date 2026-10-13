import { readFileSync } from 'node:fs';
import { createLoginVerifier } from './verify-login.mjs';

const config = JSON.parse(readFileSync(new URL('../aleph.config.json', import.meta.url), 'utf8'));
let cachedVerifier;
const headers = secret => ({ apikey: secret, Authorization: 'Bearer ' + secret, Accept: 'application/json' });
export const dbHeaders = headers;
export const safeResponseHeaders = res => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
};
// Keep the same vault_session cookie interpretation as /api/auth/session.
// Cookie is the browser's authenticated session. External engines without one
// may send a verified Authorization bearer through the existing verifier.
export function noticeAuthorization(req) {
  const cookieHeader = typeof req?.headers?.cookie === 'string' ? req.headers.cookie : '';
  const cookie = cookieHeader.split(';').map(part => part.trim())
    .find(part => part.startsWith('vault_session='))
    ?.slice('vault_session='.length);
  if (cookie) return 'Bearer ' + cookie;
  const bearer = req?.headers?.authorization;
  return typeof bearer === 'string' && bearer.length > 0 ? bearer : undefined;
}

export async function authenticateNotice(req, res) {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) { res.status(503).json({ error: 'service_unavailable' }); return null; }
  try {
    cachedVerifier ??= createLoginVerifier({ config, supabaseSecretKey: secret });
    const identity = await cachedVerifier(noticeAuthorization(req));
    if (!identity) { res.status(401).json({ error: 'unauthorized' }); return null; }
    return { identity, secret, origin: new URL(url).origin };
  } catch {
    res.status(503).json({ error: 'service_unavailable' }); return null;
  }
}
export async function instructorAllowed(state) {
  const endpoint = new URL('/rest/v1/instructor_grants', state.origin);
  endpoint.searchParams.set('select', 'user_id');
  endpoint.searchParams.set('user_id', 'eq.' + state.identity.userId);
  endpoint.searchParams.set('active', 'eq.true');
  const r = await fetch(endpoint, { headers: dbHeaders(state.secret), cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('grant_unavailable');
  const rows = await r.json();
  return Array.isArray(rows) && rows.length === 1;
}
export function validWriteOrigin(req) {
  if (req.headers?.authorization) return true;
  try {
    const origin = new URL(req.headers.origin);
    return origin.protocol === 'https:' && origin.host === req.headers.host;
  } catch { return false; }
}
export const uuid = value => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export async function jsonInput(req) {
  const value = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}
export function validNotice(value) {
  return value && typeof value.title === 'string' && value.title.trim().length > 0
    && value.title.length <= 160 && typeof value.body === 'string' && value.body.length <= 10000;
}
export const presentNotice = row => ({ id: row.id, title: row.title, body: row.content, resourceId: 'notice:' + row.id });
