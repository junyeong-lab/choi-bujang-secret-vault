import {requireApprovedDevice} from '../src/device-approval.mjs';
import { randomUUID } from 'node:crypto';
import { authenticateNotice, dbHeaders, instructorAllowed, safeResponseHeaders, validWriteOrigin,
  jsonInput, validNotice, presentNotice } from '../src/notice-access.mjs';

export default async function handler(req, res) {
  safeResponseHeaders(res);
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });
  const state = await authenticateNotice(req, res);
  if (!state) return;
  if (!await requireApprovedDevice(req,res,state.identity,{origin:process.env.SUPABASE_URL,secret:state.secret})) return;
  if (req.method === 'POST' && !validWriteOrigin(req)) return res.status(403).json({ error: 'invalid_origin' });
  const endpoint = new URL('/rest/v1/instructor_notices', state.origin);
  try {
    if (req.method === 'GET') {
      endpoint.searchParams.set('select', 'id,title,content');
      endpoint.searchParams.set('order', 'created_at.asc');
      const upstream = await fetch(endpoint, { headers: dbHeaders(state.secret), cache: 'no-store' });
      if (!upstream.ok) return res.status(502).json({ error: 'upstream_unavailable' });
      const rows = await upstream.json();
      if (!Array.isArray(rows)) return res.status(502).json({ error: 'unexpected_response' });
      return res.status(200).json({ notices: rows.map(presentNotice) });
    }
    if (!await instructorAllowed(state)) return res.status(403).json({ error: 'instructor_only' });
    let input;
    try { input = await jsonInput(req); } catch { return res.status(400).json({ error: 'invalid_json' }); }
    if (!validNotice(input)) return res.status(400).json({ error: 'invalid_notice' });
    const id = randomUUID();
    const upstream = await fetch(endpoint, { method: 'POST',
      headers: { ...dbHeaders(state.secret), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, title: input.title.trim(), content: input.body, author_id: state.identity.userId }),
      cache: 'no-store' });
    if (!upstream.ok) return res.status(502).json({ error: 'upstream_unavailable' });
    return res.status(201).json({ id, resourceId: 'notice:' + id });
  } catch { return res.status(502).json({ error: 'upstream_unavailable' }); }
}
