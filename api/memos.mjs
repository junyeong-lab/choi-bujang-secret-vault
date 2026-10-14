import {requireApprovedDevice} from '../src/device-approval.mjs';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createLoginVerifier } from '../src/verify-login.mjs';

const config = JSON.parse(readFileSync(new URL('../aleph.config.json', import.meta.url), 'utf8'));
let cachedVerifier;
function verifier(secret) {
  cachedVerifier ??= createLoginVerifier({ config, supabaseSecretKey: secret });
  return cachedVerifier;
}
function respondHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}
function dbEndpoint(url) {
  const endpoint = new URL('/rest/v1/vault_memos', url);
  if (endpoint.protocol !== 'https:') throw new Error('invalid_protocol');
  return endpoint;
}
export function dbHeaders(secret, extra = {}) {
  return { apikey: secret, ...(secret.startsWith('eyJ') ? { Authorization: `Bearer ${secret}` } : {}), Accept: 'application/json', ...extra };
}
async function authenticate(req, res) {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) { res.status(503).json({ error: 'service_unavailable' }); return null; }
  try {
    const endpoint = dbEndpoint(url);
    const bearer = req.headers.authorization;

const cookieToken = (req.headers.cookie ?? '')
  .split(';')
  .map(part => part.trim())
  .find(part => part.startsWith('vault_session='))
  ?.slice('vault_session='.length);

const authorization = bearer ??
  (cookieToken ? `Bearer ${cookieToken}` : undefined);

const identity = await verifier(secret)(authorization);
    if (!identity) { res.status(401).json({ error: 'unauthorized' }); return null; }
    return { endpoint, secret, identity };
  } catch { res.status(503).json({ error: 'service_unavailable' }); return null; }
}
async function jsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  return null;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validMemoInput(input) {
  return input && typeof input.title === 'string' && input.title.trim().length > 0
    && input.title.length <= 160 && typeof input.body === 'string' && input.body.length <= 10000;
}
function present(row) { return { id: row.id, title: row.title, body: row.content, resourceId: 'memo:' + row.id }; }

export default async function handler(req, res) {
  respondHeaders(res);
  if (!['GET','POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const state = await authenticate(req, res);
  if (!state) return;
  const { endpoint, secret, identity } = state;
  if (!await requireApprovedDevice(req,res,identity,{origin:process.env.SUPABASE_URL,secret})) return;
if (req.method === 'POST' && !req.headers.authorization) {
  let validOrigin = false;

  try {
    const origin = new URL(req.headers.origin);
    const host = req.headers.host;

    validOrigin =
      origin.protocol === 'https:' &&
      origin.host === host;
  } catch {
    validOrigin = false;
  }

  if (!validOrigin) {
    return res.status(403).json({ error: 'invalid_origin' });
  }
}
  try {
    if (req.method === 'GET') {
      endpoint.searchParams.set('select', 'id,title,content');
      endpoint.searchParams.set('order', 'created_at.asc');
      endpoint.searchParams.set('owner_id', `eq.${identity.userId}`);
      // 소유자 기준 조회. role이나 쿼리 소유자 값은 사용하지 않습니다.
      const upstream = await fetch(endpoint, { headers: dbHeaders(secret), cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!upstream.ok) return res.status(502).json({ error: 'upstream_unavailable' });
      const rows = await upstream.json();
      if (!Array.isArray(rows)) return res.status(502).json({ error: 'unexpected_response' });
      return res.status(200).json({ notes: rows.map(present) });
    }
    let input;
    try { input = await jsonBody(req); } catch { return res.status(400).json({ error: 'invalid_json' }); }
    if (!validMemoInput(input) || (input.id != null && !UUID.test(input.id))) {
      return res.status(400).json({ error: 'invalid_memo' });
    }
    const id = input.id ?? randomUUID();
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: dbHeaders(secret, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify({ id, title: input.title.trim(), content: input.body, owner_id: identity.userId }),
      signal: AbortSignal.timeout(8000), cache: 'no-store',
    });
    if (upstream.status === 409) return res.status(409).json({ error: 'memo_exists' });
    if (!upstream.ok) return res.status(502).json({ error: 'upstream_unavailable' });
    return res.status(201).json({ id });
  } catch { return res.status(502).json({ error: 'upstream_unavailable' }); }
}
