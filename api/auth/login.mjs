
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const origin = req.headers.origin;
  const host = req.headers.host;

  if (!origin || !host) {
    return res.status(403).json({ error: 'invalid_origin' });
  }

  try {
    const source = new URL(origin);
    if (source.protocol !== 'https:' || source.host !== host) {
      return res.status(403).json({ error: 'invalid_origin' });
    }
  } catch {
    return res.status(403).json({ error: 'invalid_origin' });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    return res.status(503).json({ error: 'service_unavailable' });
  }

  const input = req.body;

  if (
    !input ||
    typeof input.email !== 'string' ||
    typeof input.password !== 'string' ||
    input.email.length > 254 ||
    input.password.length > 1024
  ) {
    return res.status(400).json({ error: 'invalid_input' });
  }

  try {
    const supabase = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });

    const { data, error } = await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.password
    });

    if (error || !data.session?.access_token || !data.user) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    const age = Math.min(
      Math.max(Math.floor(data.session.expires_in ?? 0), 0),
      3600
    );

    if (age < 1) {
      return res.status(503).json({ error: 'invalid_session' });
    }

    res.setHeader('Set-Cookie',
      `vault_session=${data.session.access_token}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=${age}`
    );

    return res.status(200).json({
      user: { email: data.user.email }
    });
  } catch {
    return res.status(503).json({ error: 'login_unavailable' });
  }
}