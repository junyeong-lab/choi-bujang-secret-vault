import { readFileSync } from 'node:fs';
import { createLoginVerifier } from '../../src/verify-login.mjs';

const config = JSON.parse(readFileSync(new URL('../../aleph.config.json', import.meta.url), 'utf8'));
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
function dbHeaders(secret, extra = {}) {
  return { apikey: secret, Authorization: `Bearer ${secret}`, Accept: 'application/json', ...extra };
}
async function authenticate(req, res) {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) { res.status(503).json({ error: 'service_unavailable' }); return null; }
  try {
    const endpoint = dbEndpoint(url);
    const identity = await verifier(secret)(req.headers.authorization);
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
function present(row) { return { id: row.id, title: row.title, body: row.content }; }

// Dynamic Vercel route /api/memos/:id. 3단계에서는 모든 로그인 사용자가 조회/수정/삭제할 수 있습니다.
export default async function handler(req, res) {
  respondHeaders(res);
  if (!['GET','PUT','DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'GET, PUT, DELETE');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const state = await authenticate(req, res);
  if (!state) return;
  const { endpoint, secret } = state;
  const id = req.query?.id;
  // 이전 단계의 가상 메모 ID는 UUID가 아닐 수도 있어 안전한 문자열 ID를 함께 지원합니다.
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    return res.status(400).json({ error: 'invalid_id' });
  }
  endpoint.searchParams.set('id', `eq.${id}`);
  try {
    if (req.method === 'GET') {
      endpoint.searchParams.set('select', 'id,title,content');
      const upstream = await fetch(endpoint, { headers: dbHeaders(secret), cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!upstream.ok) return res.status(502).json({ error: 'upstream_unavailable' });
      const rows = await upstream.json();
      if (!Array.isArray(rows)) return res.status(502).json({ error: 'unexpected_response' });
      if (!rows.length) return res.status(404).json({ error: 'not_found' });
      return res.status(200).json(present(rows[0]));
    }
    if (req.method === 'PUT') {
      let input;
      try { input = await jsonBody(req); } catch { return res.status(400).json({ error: 'invalid_json' }); }
      if (!validMemoInput(input)) return res.status(400).json({ error: 'invalid_memo' });
      const upstream = await fetch(endpoint, {
        method: 'PATCH',
        headers: dbHeaders(secret, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
        body: JSON.stringify({ title: input.title.trim(), content: input.body }),
        signal: AbortSignal.timeout(8000), cache: 'no-store',
      });
      if (!upstream.ok) return res.status(502).json({ error: 'upstream_unavailable' });
      const rows = await upstream.json();
      if (!Array.isArray(rows)) return res.status(502).json({ error: 'unexpected_response' });
      if (!rows.length) return res.status(404).json({ error: 'not_found' });
      return res.status(200).json(present(rows[0]));
    }
    const upstream = await fetch(endpoint, {
      method: 'DELETE', headers: dbHeaders(secret, { Prefer: 'return=representation' }),
      signal: AbortSignal.timeout(8000), cache: 'no-store',
    });
    if (!upstream.ok) return res.status(502).json({ error: 'upstream_unavailable' });
    const rows = await upstream.json();
    if (!Array.isArray(rows)) return res.status(502).json({ error: 'unexpected_response' });
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    return res.status(204).end();
  } catch { return res.status(502).json({ error: 'upstream_unavailable' }); }
}
