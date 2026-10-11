import { readFileSync } from 'node:fs';
import { createLoginVerifier } from '../src/verify-login.mjs';

const config = JSON.parse(readFileSync(new URL('../aleph.config.json', import.meta.url), 'utf8'));
let cachedVerifier;

function loginVerifier(secret) {
  if (!cachedVerifier) {
    cachedVerifier = createLoginVerifier({ config, supabaseSecretKey: secret });
  }
  return cachedVerifier;
}

// 3단계: 검증된 로그인 토큰이 없으면 학습용 메모를 반환하지 않습니다.
// 4단계에서 사용자별 소유권 인가를 별도로 구현합니다.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    return res.status(503).json({ error: 'service_unavailable' });
  }

  let identity;
  try {
    identity = await loginVerifier(secret)(req.headers.authorization);
  } catch {
    return res.status(503).json({ error: 'service_unavailable' });
  }
  if (!identity) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  let endpoint;
  try {
    endpoint = new URL('/rest/v1/vault_memos', url);
    if (endpoint.protocol !== 'https:') throw new Error('invalid_protocol');
  } catch {
    return res.status(503).json({ error: 'service_unavailable' });
  }
  endpoint.searchParams.set('select', 'id,title,content');
  endpoint.searchParams.set('order', 'id.asc');
  endpoint.searchParams.set('limit', '4');

  try {
    const upstream = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'apikey': secret,
        'Authorization': `Bearer ${secret}`,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (!upstream.ok) {
      // 응답/로그에 upstream 본문이나 secret을 넣지 않습니다.
      return res.status(502).json({ error: 'upstream_unavailable' });
    }
    const rows = await upstream.json();
    if (!Array.isArray(rows)) return res.status(502).json({ error: 'unexpected_response' });
    return res.status(200).json({ notes: rows.map(row => ({ id: row.id, title: row.title, content: row.content })) });
  } catch {
    return res.status(502).json({ error: 'upstream_unavailable' });
  }
}
