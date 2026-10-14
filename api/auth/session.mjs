
import { readFileSync } from 'node:fs';
import { createLoginVerifier } from '../../src/verify-login.mjs';

const config = JSON.parse(
  readFileSync(new URL('../../aleph.config.json', import.meta.url), 'utf8')
);

let cachedVerifier;

function verifier(secret) {
  cachedVerifier ??= createLoginVerifier({
    config,
    supabaseSecretKey: secret
  });
  return cachedVerifier;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Retire the old, separately browser-stored device token. The new
  // verification state lives only on the server, keyed by this login session.
  res.setHeader('Set-Cookie',
    'vault_device=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) {
    return res.status(503).json({ error: 'service_unavailable' });
  }

  const rawCookie = req.headers.cookie ?? '';
  const token = rawCookie.split(';').map(part => part.trim())
    .find(part => part.startsWith('vault_session='))
    ?.slice('vault_session='.length);

  if (!token) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const identity = await verifier(secret)(`Bearer ${token}`);

    if (!identity || identity.kind !== 'student') {
      return res.status(401).json({ error: 'unauthorized' });
    }

    return res.status(200).json({ authenticated: true });
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }
}