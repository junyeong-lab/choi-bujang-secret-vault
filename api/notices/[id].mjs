import {requireApprovedDevice} from '../../src/device-approval.mjs';
import { authenticateNotice, dbHeaders, instructorAllowed, safeResponseHeaders, validWriteOrigin,
  jsonInput, validNotice, presentNotice, uuid } from '../../src/notice-access.mjs';

export default async function handler(req, res) {
  safeResponseHeaders(res);
  if (!['GET', 'PUT', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });
  const state = await authenticateNotice(req, res);
  if (!state) return;
  if (!await requireApprovedDevice(req,res,state.identity,{origin:process.env.SUPABASE_URL,secret:state.secret})) return;
  const id = req.query?.id;
  if (!uuid(id)) return res.status(400).json({ error: 'invalid_id' });
  if (req.method !== 'GET' && !validWriteOrigin(req)) return res.status(403).json({ error: 'invalid_origin' });
  const endpoint = new URL('/rest/v1/instructor_notices', state.origin);
  endpoint.searchParams.set('id', 'eq.' + id);
  try {
    if (req.method === 'GET') {
      endpoint.searchParams.set('select', 'id,title,content');
      const upstream = await fetch(endpoint, { headers: dbHeaders(state.secret), cache: 'no-store' });
      if (!upstream.ok) return res.status(502).json({ error: 'upstream_unavailable' });
      const rows = await upstream.json();
      if (!Array.isArray(rows)) return res.status(502).json({ error: 'unexpected_response' });
      if (!rows.length) return res.status(404).json({ error: 'not_found' });
      return res.status(200).json(presentNotice(rows[0]));
    }
    if (!await instructorAllowed(state)) return res.status(403).json({ error: 'instructor_only' });
    if (req.method === 'PUT') {
      let input;
      try { input = await jsonInput(req); } catch { return res.status(400).json({ error: 'invalid_json' }); }
      if (!validNotice(input)) return res.status(400).json({ error: 'invalid_notice' });
      const upstream = await fetch(endpoint, { method: 'PATCH',
        headers: { ...dbHeaders(state.secret), 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ title: input.title.trim(), content: input.body }), cache: 'no-store' });
      if (!upstream.ok) return res.status(502).json({ error: 'upstream_unavailable' });
      const rows = await upstream.json();
      if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ error: 'not_found' });
      return res.status(200).json(presentNotice(rows[0]));
    }
    const upstream = await fetch(endpoint, { method: 'DELETE',
      headers: { ...dbHeaders(state.secret), Prefer: 'return=representation' }, cache: 'no-store' });
    if (!upstream.ok) return res.status(502).json({ error: 'upstream_unavailable' });
    const rows = await upstream.json();
    if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ error: 'not_found' });
    return res.status(204).end();
  } catch { return res.status(502).json({ error: 'upstream_unavailable' }); }
}
