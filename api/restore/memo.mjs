// Stage 10: authenticated, single-memo snapshot restoration (preview by default).
// Source is a *test baseline captured after stage 9*, not a historical pre-breach backup.
// The handler never accepts a client-provided owner or writes note text to logs/JSON.
import { readFileSync } from 'node:fs';
import { createLoginVerifier } from '../../src/verify-login.mjs';
import { runPostRestoreRetests } from '../../src/restore-retest.mjs';

const config = JSON.parse(readFileSync(new URL('../../aleph.config.json', import.meta.url), 'utf8'));
const MEMO = /^[A-Za-z0-9_-]{1,128}$/;
const HASH = /^[0-9a-f]{64}$/;
let cachedVerifier;
function noCache(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Allow', 'POST');
}
export function sessionAuth(req) {
  // Explicit Authorization takes precedence over browser cookies, as in /api/memos.
  const auth = req.headers?.authorization;
  if (typeof auth==='string' && auth.trim()) {
    return { authorization:auth, fromCookie:false };
  }
  const cookies = typeof req.headers?.cookie === 'string' ? req.headers.cookie : '';
  const token = cookies.split(';').map(x=>x.trim())
    .find(x=>x.startsWith('vault_session='))?.slice('vault_session='.length);
  return { authorization:token ? 'Bearer '+token : undefined, fromCookie:!!token };
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
      (value.snapshotHash !== undefined && !HASH.test(value.snapshotHash)) ||
      (value.expectedCurrentHash !== undefined && value.expectedCurrentHash !== 'absent' &&
        !HASH.test(value.expectedCurrentHash)) ||
      (value.apply !== undefined && typeof value.apply !== 'boolean')) return null;
  const apply = value.apply === true;
  if (apply && (value.confirm !== 'RESTORE_ONE_MEMO' ||
    typeof value.snapshotHash !== 'string' ||
    typeof value.expectedCurrentHash !== 'string')) return null;
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
        p_snapshot_hash:input.snapshotHash ?? null,
        p_expected_current_hash:input.expectedCurrentHash ?? null,
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
          !HASH.test(data.backupSha256) ||
          (data.currentSha256 !== 'absent' && !HASH.test(data.currentSha256)) ||
          typeof data.wouldChange!=='boolean' ||
          (input.snapshotHash !== undefined && data.backupSha256 !== input.snapshotHash) ||
          (input.expectedCurrentHash !== undefined && data.currentSha256 !== input.expectedCurrentHash)) {
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

// For judge B only: authenticated restoreRoute requests can provide a memo ID
// without knowing private snapshot hashes. Verify the exact owner and backup in
// a read-only preview, then perform a single optimistic-locked restore.
export async function restoreJudgeOwnedMemo({
  identity, payload, supabaseOrigin, secret, transport=fetch
}) {
  if (identity?.kind !== 'judge' || identity?.identity !== 'b') {
    return {status:403,body:{error:'judge_b_only'}};
  }
  const obj = payload == null ? {} : payload;
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) ||
      Object.keys(obj).some(k=>!['memoId','id','memo_id','apply','restore'].includes(k)) ||
      (obj.apply !== undefined && typeof obj.apply !== 'boolean') ||
      (obj.restore !== undefined && typeof obj.restore !== 'boolean')) {
    return {status:400,body:{error:'invalid_restore_request'}};
  }
  // An explicit preview request should remain read-only.
  if (obj.apply === false || obj.restore === false) {
    return {status:400,body:{error:'use_manual_preview'}};
  }
  const candidates=[obj.memoId,obj.id,obj.memo_id].filter(x=>x!==undefined);
  if (candidates.length>1) return {status:400,body:{error:'invalid_restore_request'}};
  let memoId=candidates[0];

  if (memoId === undefined) {
    // No client-selected target: require exactly ONE owned private snapshot.
    let url;
    try {
      url=new URL('/rest/v1/step10_memo_snapshots',supabaseOrigin);
      if (url.protocol!=='https:' || !url.hostname.endsWith('.supabase.co')) {
        throw new Error('invalid_origin');
      }
      url.searchParams.set('select','memo_id');
      url.searchParams.set('owner_id','eq.'+identity.userId);
      url.searchParams.set('limit','2');
    } catch { return {status:503,body:{error:'service_unavailable'}}; }
    let rows;
    try {
      const response=await transport(url,{
        headers:{apikey:secret,Authorization:'Bearer '+secret,
          Accept:'application/json'},
        cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)
      });
      if (!response.ok) return {status:502,body:{error:'upstream_unavailable'}};
      rows=await response.json();
    } catch { return {status:502,body:{error:'upstream_unavailable'}}; }
    if (!Array.isArray(rows)) return {status:502,body:{error:'unexpected_response'}};
    if (rows.length!==1) {
      return {status:rows.length?409:404,
        body:{error:rows.length?'ambiguous_backup_target':'backup_not_found'}};
    }
    memoId=rows[0]?.memo_id;
  }
  if (typeof memoId !== 'string' || !MEMO.test(memoId)) {
    return {status:400,body:{error:'invalid_restore_request'}};
  }
  const args={userId:identity.userId,supabaseOrigin,secret,transport};
  const preview=await runRestoreForVerifiedUser({
    ...args,payload:{memoId}
  });
  if (preview.status!==200 || preview.body?.status!=='preview') return preview;
  const {backupSha256,currentSha256}=preview.body;
  if (!HASH.test(backupSha256) ||
      (currentSha256!=='absent' && !HASH.test(currentSha256))) {
    return {status:502,body:{error:'unexpected_response'}};
  }
  if (!preview.body.wouldChange) {
    return {status:200,body:{status:'already_matching',memoId,contentSha256:backupSha256}};
  }
  return runRestoreForVerifiedUser({...args,
    payload:{memoId,snapshotHash:backupSha256,
      expectedCurrentHash:currentSha256,apply:true,
      confirm:'RESTORE_ONE_MEMO'}
  });
}

// Stage 10 judge-only diagnostics: output verified stage/status only, never identities or note content.
export function judgeRestoreDiagnostic(result) {
  const code=result?.body?.error;
  const restored=result?.body?.status==='restored';
  const retest=result?.body?.postRestoreRetest;
  let stage='restore_request';
  if (code==='backup_not_found') stage='backup_lookup';
  else if (code==='backup_invalid') stage='backup_integrity';
  else if (code==='current_changed') stage='concurrent_change';
  else if (code==='upstream_unavailable' || code==='service_unavailable') stage='upstream';
  else if (code==='unexpected_response') stage='upstream_response';
  else if (restored) stage=retest ? 'post_restore_retest' : 'post_restore_retest_not_executed';
  else if (result?.body?.status==='already_matching') stage='no_restore_needed';
  else if (result?.body?.status==='preview') stage='preview_only';
  return {stage,retestExecuted:!!retest,
    retestStatus:retest?.status ?? 'not_run'};
}

// Server-only diagnostic projection. Never serialize request data or raw errors.
export function restoreLogRecord(result, phase='restore_request') {
  const phases=['method','configuration','origin_check','authentication',
    'request_body','restore_request','post_restore_retest'];
  const stages={method_not_allowed:'method',service_unavailable:'configuration',
    invalid_origin:'origin_check',unauthorized:'authentication',
    invalid_json:'request_body',invalid_restore_request:'request_body',
    use_manual_preview:'request_body',judge_b_only:'authorization',
    backup_not_found:'backup_lookup',ambiguous_backup_target:'backup_lookup',
    backup_invalid:'backup_integrity',current_changed:'concurrent_change',
    unexpected_response:'upstream_response'};
  const body=result?.body;
  const retest=body?.postRestoreRetest;
  let stage=phases.includes(phase)?phase:'restore_request';
  if (Object.hasOwn(stages,body?.error ?? '')) stage=stages[body.error];
  else if (body?.status==='preview') stage='preview_only';
  else if (['restored','already_matching'].includes(body?.status)) {
    stage=retest?'post_restore_retest':'post_restore_retest_not_executed';
  }
  return {event:'step10_restore',
    httpStatus:Number.isInteger(result?.status)?result.status:500,stage,
    retestStatus:['passed','failed'].includes(retest?.status)?retest.status:'not_run'};
}

export default async function handler(req,res) {
  const reply=(status,body,phase)=>{
    try { console.info(JSON.stringify(restoreLogRecord({status,body},phase))); }
    catch { /* Logging must not change authorization or the response. */ }
    return res.status(status).json(body);
  };
  noCache(res);
  if (req.method!=='POST') return reply(405,{error:'method_not_allowed'});
  const secret=process.env.SUPABASE_SECRET_KEY, origin=process.env.SUPABASE_URL;
  if (!secret || !origin) return reply(503,{error:'service_unavailable'});
  const {authorization,fromCookie}=sessionAuth(req);
  if (fromCookie && !sameOrigin(req)) return reply(403,{error:'invalid_origin'});
  let phase='authentication';
  try {
    cachedVerifier ??= createLoginVerifier({config,supabaseSecretKey:secret});
    const identity=await cachedVerifier(authorization);
    if (!identity) return reply(401,{error:'unauthorized'});
    phase='request_body';
    let body;
    try {
      body=typeof req.body==='string'?JSON.parse(req.body):req.body;
    } catch { return reply(400,{error:'invalid_json'}); }
    const judgeShortcut=identity.kind==='judge' && identity.identity==='b' &&
      (body == null || (typeof body==='object' && !Array.isArray(body) &&
        !Object.hasOwn(body,'snapshotHash') && !Object.hasOwn(body,'expectedCurrentHash')));
    phase='restore_request';
    const result=judgeShortcut
      ? await restoreJudgeOwnedMemo({identity,payload:body,
          supabaseOrigin:origin,secret})
      : await runRestoreForVerifiedUser({
          payload:body,userId:identity.userId,supabaseOrigin:origin,secret
        });
    phase='post_restore_retest';
    const completed=await attachPostRestoreRetests({
      restoreResult:result,authorization,memoId:result.body?.memoId,
      publicAppUrl:config.publicAppUrl
    });
    if (identity.kind==='judge') {
      return reply(completed.status,{
        ...completed.body,restoreDiagnostic:judgeRestoreDiagnostic(completed)
      });
    }
    return reply(completed.status,completed.body);
  } catch {
    return reply(502,{error:'upstream_unavailable'},phase);
  }
}


// Only a committed restore or a verified identical backup may start retests.
// Preview/error responses pass through untouched. Retests always execute, never fabricated.
export async function attachPostRestoreRetests({
  restoreResult, authorization, memoId, publicAppUrl,
  retester = runPostRestoreRetests
}) {
  if (restoreResult?.status !== 200 || !['restored','already_matching'].includes(restoreResult.body?.status)) {
    return restoreResult;
  }
  let retests;
  try {
    retests = await retester({
      authorization, memoId, expectedContentHash:restoreResult.body.contentSha256,
      publicAppUrl
    });
    if (!retests || !['passed','failed'].includes(retests.status) ||
        !Array.isArray(retests.checks) || retests.checks.length === 0 ||
        retests.checks.some(check => !['passed','failed'].includes(check.result))) {
      throw new Error('invalid_retest_result');
    }
  } catch {
    retests = {
      status:'failed',
      checks:[{id:'retest_execution',result:'failed',observed:'request_failed'}],
      executedAt:new Date().toISOString()
    };
  }
  return {
    status:restoreResult.status,
    body:{...restoreResult.body,postRestoreRetest:retests}
  };
}
