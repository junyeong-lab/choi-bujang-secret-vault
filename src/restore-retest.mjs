// Stage 10 - retest AFTER a successful one-memo restore.
// Every recorded result comes from an actual API response or executed policy detector.
// Never log or return tokens, note titles, memo bodies, or user identifiers.
import { createHash } from 'node:crypto';
import { decide } from './decider.mjs';
import { detect } from './detect.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';

function outcome(id, passed, observed) {
  return { id, result:passed ? 'passed' : 'failed', observed };
}
const MEMO_ID=/^[A-Za-z0-9_-]{1,128}$/;
const SHA=/^[0-9a-f]{64}$/;
export async function runPostRestoreRetests({
  authorization, memoId, expectedContentHash, publicAppUrl, transport=fetch
}) {
  const executedAt=new Date().toISOString();
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ') ||
      !MEMO_ID.test(memoId) || !SHA.test(expectedContentHash)) {
    return {status:'failed',executedAt,
      checks:[outcome('retest_inputs',false,'invalid_verified_context')]};
  }
  let base;
  try {
    base=new URL(publicAppUrl);
    if(base.protocol!=='https:' || base.username || base.password ||
       base.pathname!=='/' || base.search || base.hash ||
       !base.hostname.endsWith('.vercel.app')) throw Error('invalid_base');
  } catch {
    return {status:'failed',executedAt,
      checks:[outcome('retest_inputs',false,'invalid_public_app_url')]};
  }

  async function probe(path, useAuth=true, method='GET', body=null) {
    try {
      const headers=useAuth ? {Authorization:authorization,Accept:'application/json'} :
        {Accept:'application/json'};
      if(method==='POST') headers['Content-Type']='application/json';
      const response=await transport(new URL(path,base),{
        method,headers,
        ...(body===null?{}:{body:JSON.stringify(body)}),
        redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000)
      });
      if(!Number.isInteger(response?.status)) return {status:0};
      return response;
    } catch { return {status:0}; }
  }

  // All live checks must run after DB reports status='restored'.
  const [own,other,anonymous,noticeWrite]=await Promise.all([
    probe('/api/memos/'+encodeURIComponent(memoId)),
    probe('/api/memos/sample-note-1'),
    probe('/api/memos',false),
    probe('/api/notices',true,'POST',{})
  ]);

  const checks=[];
  let ownPassed=false;
  if(own.status===200) {
    try {
      const data=await own.json();
      ownPassed=data?.id===memoId && typeof data.body==='string' &&
        createHash('sha256').update(data.body,'utf8').digest('hex')===expectedContentHash;
    } catch { ownPassed=false; }
  }
  checks.push(outcome('restored_owner_read',ownPassed,
    own.status===200?(ownPassed?'HTTP_200_HASH_MATCH':'HTTP_200_HASH_MISMATCH'):
      (own.status?'HTTP_'+own.status:'request_failed')));
  checks.push(outcome('other_owner_memo_denied',other.status===404,
    other.status?'HTTP_'+other.status:'request_failed'));
  checks.push(outcome('anonymous_memo_list_denied',[401,403].includes(anonymous.status),
    anonymous.status?'HTTP_'+anonymous.status:'request_failed'));
  checks.push(outcome('student_notice_write_denied',noticeWrite.status===403,
    noticeWrite.status?'HTTP_'+noticeWrite.status:'request_failed'));

  // Run the existing 6-9 policies after the real restored-resource tests.
  // They are labeled as local policy/detector checks, not as live API requests.
  try {
    const {normal,suspicious}=fixtureRequests();
    const approved=await decide({...normal,
      method:'GET',path:'/api/memos/'+memoId,route:'GET /api/memos/:id'});
    const unregistered=await decide({...normal,deviceRegistered:false});
    const stepUp=await decide(suspicious);
    const resourceDenied=await decide({...normal,
      method:'GET',path:'/api/memos',route:'GET /api/memos'});
    checks.push(outcome('policy_registered_device',approved.decision==='allow',
      'decision_'+approved.decision));
    checks.push(outcome('policy_unregistered_device',unregistered.decision==='deny',
      'decision_'+unregistered.decision));
    checks.push(outcome('policy_composite_step_up',stepUp.decision==='step_up',
      'decision_'+stepUp.decision));
    checks.push(outcome('policy_other_zone_denied',resourceDenied.decision==='deny',
      'decision_'+resourceDenied.decision));
  } catch {
    checks.push(outcome('policy_replay',false,'execution_failed'));
  }
  try {
    const events=Array.from({length:121},(_,i)=>({
      at:new Date(Date.UTC(2026,9,1,0,0,0)+i*1000).toISOString(),
      method:'GET',identity:{sub:'synthetic_retest'}
    }));
    const normal=detect(events.slice(0,120));
    const burst=detect(events);
    checks.push(outcome('detector_normal_read',
      normal.action==='observe','action_'+normal.action));
    checks.push(outcome('detector_burst_read',
      burst.action==='propose_revocation' && burst.reasonCode==='burst_read',
      'action_'+burst.action));
  } catch {
    checks.push(outcome('detector_replay',false,'execution_failed'));
  }
  return {
    status:checks.every(c=>c.result==='passed')?'passed':'failed',
    executedAt,checks
  };
}
