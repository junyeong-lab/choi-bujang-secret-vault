
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

  res.setHeader(
    'Set-Cookie',
    'vault_session=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0'
  );

  return res.status(200).json({ success: true });
}