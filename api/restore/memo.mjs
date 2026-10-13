// Stage 10: authenticated, single-memo snapshot restoration (preview by default).
// Source is a *test baseline captured after stage 9*, not a historical pre-breach backup.
// The handler never accepts a client-provided owner or writes note text to logs/JSON.
import { readFileSync } from 'node:fs';
import { createLoginVerifier } from '../../src/verify-login.mjs';

const config = JSON.parse(readFileSync(new URL('../../aleph.config.json', import.meta.url), 'utf8'));
const MEMO = /^[A-Za-z0-9_-]{1,128}$/;
const HASH = /^[0-9a-f]{64}$/;
let cachedVerifier;
function noCache(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Allow', 'POST');
}
function sessionAuth(req) {
  const cookies = typeof req.headers?.cookie === 'string' ? req.headers.cookie : '';
  const token = cookies.split(';').map(x=>x.trim())
    .find(x=>x.startsWith('vault_session='))?.slice('vault_session='.length);
  if (token) return { authorization:'Bearer '+token, fromCookie:true };
  const auth = req.headers?.authorization;
  return { authorization:typeof auth==='string' ? auth : undefined, fromCookie:false };
}
function sameOrigin(req) {
  try {
    const origin = new URL(req.headers.origin);
    return origin.protocol === 'https:' && origin.host === req.headers.host;
  } catch { return false; }
}
export function validateRestorePayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.memoId !== 'string' || !MEMO.test(value.memoId) ||
      (typeof value.snapshotHash !== 'string' || !HASH.test(value.snapshotHash)) ||
      (value.expectedCurrentHash !== 'absent' && !HASH.test(value.expectedCurrentHash)) ||
      (value.apply !== undefined && typeof value.apply !== 'boolean')) return null;
  const apply = value.apply === true;
  if (apply && value.confirm !== 'RESTORE_ONE_MEMO') return null;
  // Reject any extra potentially dangerous selector; owner is the VERIFIED login id.
  if (Object.keys(value).some(k => !['memoId','snapshotHash','expectedCurrentHash','apply','confirm'].includes(k))) return null;
  return { memoId:value.memoId, snapshotHash:value.snapshotHash,
    expectedCurrentHash:value.expectedCurrentHash, apply };
}

export async function runRestoreForVerifiedUser({ payload, userId, supabaseOrigin, secret, transport=fetch }) {
  if (typeof userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(userId)) {
    return { status:401, body:{error:'unauthorized'} };
  }
  const input = validateRestorePayload(payload);
  if (!input) return { status:400, body:{error:'invalid_restore_request'} };
  let endpoint;
  try {
    endpoint = new URL('/rest/v1/rpc/step10_restore_one_memo',supabaseOrigin);
    if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.supabase.co')) throw new Error('invalid_origin');
  } catch { return {status:503,body:{error:'service_unavailable'}}; }
  let upstream;
  try {
    upstream = await transport(endpoint, {
      method:'POST',
      headers: {apikey:secret,Authorization:'Bearer '+secret,
        'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify({
        p_id:input.memoId,
        p_owner_id:userId,
        p_snapshot_hash:input.snapshotHash,
        p_expected_current_hash:input.expectedCurrentHash,
        p_apply:input.apply
      }),
      cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)
    });
  } catch { return {status:502,body:{error:'upstream_unavailable'}}; }
  if (!upstream.ok) return {status:502,body:{error:'upstream_unavailable'}};
  let data;
  try { data=await upstream.json(); } catch { return {status:502,body:{error:'upstream_unavailable'}}; }
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.status !== 'string') {
    return {status:502,body:{error:'unexpected_response'}};
  }
  switch (data.status) {
    case 'preview':
      if (input.apply || data.memoId!==input.memoId || data.ownerMatched!==true ||
          !HASH.test(data.backupSha256) || !['absent'].concat([]).includes(data.currentSha256) &&
          !HASH.test(data.currentSha256) || typeof data.wouldChange!=='boolean') {
        return {status:502,body:{error:'unexpected_response'}};
      }
      return {status:200,body:{status:'preview',memoId:input.memoId,ownerMatched:true,
        currentSha256:data.currentSha256,backupSha256:data.backupSha256,
        wouldChange:data.wouldChange}};
    case 'restored':
      if (!input.apply || data.memoId!==input.memoId || data.ownerMatched!==true ||
          data.contentSha256!==input.snapshotHash) return {status:502,body:{error:'unexpected_response'}};
      return {status:200,body:{status:'restored',memoId:input.memoId,
        ownerMatched:true,contentSha256:data.contentSha256}};
    case 'backup_not_found':
      return {status:404,body:{error:'backup_not_found'}};
    case 'backup_invalid':
      return {status:409,body:{error:'backup_invalid'}};
    case 'current_changed':
      return {status:409,body:{error:'current_changed'}};
    case 'owner_mismatch':
      return {status:404,body:{error:'backup_not_found'}};
    case 'invalid_request':
      return {status:400,body:{error:'invalid_restore_request'}};
    default:
      return {status:502,body:{error:'unexpected_response'}};
  }
}

export default async function handler(req,res) {
  noCache(res);
  if (req.method!=='POST') return res.status(405).json({error:'method_not_allowed'});
  const secret=process.env.SUPABASE_SECRET_KEY, origin=process.env.SUPABASE_URL;
  if (!secret || !origin) return res.status(503).json({error:'service_unavailable'});
  const {authorization,fromCookie}=sessionAuth(req);
  if (fromCookie && !sameOrigin(req)) return res.status(403).json({error:'invalid_origin'});
  try {
    cachedVerifier ??= createLoginVerifier({config,supabaseSecretKey:secret});
    const identity=await cachedVerifier(authorization);
    if (!identity) return res.status(401).json({error:'unauthorized'});
    let body;
    try {
      body=typeof req.body==='string'?JSON.parse(req.body):req.body;
    } catch { return res.status(400).json({error:'invalid_json'}); }
    const result=await runRestoreForVerifiedUser({
      payload:body,userId:identity.userId,supabaseOrigin:origin,secret
    });
    return res.status(result.status).json(result.body);
  } catch {
    return res.status(502).json({error:'upstream_unavailable'});
  }
}
