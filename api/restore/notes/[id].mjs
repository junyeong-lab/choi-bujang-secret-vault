import {requireApprovedDevice} from '../../../src/device-approval.mjs';
// Stage 10: judge-provided private backup route.
// No request body selectors are accepted. Authorization selects the owner,
// and the path selects exactly one memo. All material stays server-side.
import {readFileSync} from 'node:fs';
import {createLoginVerifier} from '../../../src/verify-login.mjs';
import {sessionAuth,restoreJudgeOwnedMemo,attachPostRestoreRetests,
  judgeRestoreDiagnostic,restoreLogRecord} from '../memo.mjs';
import {restoreFromEnv} from '../../../src/step10-env-backup.mjs';

const config=JSON.parse(readFileSync(new URL('../../../aleph.config.json',import.meta.url),'utf8'));
const ID=/^[A-Za-z0-9_-]{1,128}$/;
let verify;
function safeOrigin(req) {
  try {
    const origin=new URL(req.headers.origin);
    return origin.protocol==='https:'&&origin.host===req.headers.host;
  }catch{return false;}
}
export function emptyOnly(body){
  if(body===undefined||body===null||body==='')return true;
  if(typeof body==='string'){try{body=JSON.parse(body)}catch{return false;}}
  return !!body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).length===0;
}

export async function runStep10Restore({
  id,identity,authorization,body,
  backupJson=process.env.RESTORE_NOTE_BACKUP_JSON,
  backupSha256=process.env.RESTORE_NOTE_BACKUP_SHA256,
  supabaseOrigin=process.env.SUPABASE_URL,
  secret=process.env.SUPABASE_SECRET_KEY,
  transport=fetch,retester
}){
  if(!emptyOnly(body))return {status:400,body:{error:'invalid_restore_request'}};
  if(typeof id!=='string'||!ID.test(id))
    return {status:400,body:{error:'invalid_restore_request'}};
  if(!identity?.userId||!['judge','student'].includes(identity.kind))
    return {status:401,body:{error:'unauthorized'}};
  // A half-provisioned environment must not silently fall back to DB.
  const envProvided=backupJson!==undefined||backupSha256!==undefined;
  let result;
  if(envProvided){
    result=await restoreFromEnv({raw:backupJson,integrityHash:backupSha256,id,
      ownerId:identity.userId,supabaseOrigin,secret,transport});
  }else if(identity.kind==='judge'&&identity.identity==='b'){
    // Preserve existing validated DB backup behavior for production installations
    // where the optional private judge backup is not provided.
    result=await restoreJudgeOwnedMemo({
      identity,payload:{id},supabaseOrigin,secret,transport
    });
  }else{
    result={status:503,body:{error:'backup_unavailable'}};
  }
  const completed=await attachPostRestoreRetests({
    restoreResult:result,authorization,memoId:result.body?.memoId,
    publicAppUrl:config.publicAppUrl,
    ...(retester?{retester}: {})
  });
  if(completed.status===200&&completed.body?.status==='restored'&&
     completed.body.postRestoreRetest){
    const retests=completed.body.postRestoreRetest;
    return {...completed,body:{...completed.body,
      restore:{retests:{status:retests.status,executedAt:retests.executedAt??null,
        checks:retests.checks}}}};
  }
  return completed;
}

export default async function handler(req,res) {
  const reply=(code,body)=>{
    try{console.info(JSON.stringify(restoreLogRecord({status:code,body})));}catch{}
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    return res.status(code).json(body);
  };
  if(req.method!=='POST'){
    res.setHeader('Allow','POST');
    return reply(405,{error:'method_not_allowed'});
  }
  const secret=process.env.SUPABASE_SECRET_KEY;
  if(!secret||!process.env.SUPABASE_URL)return reply(503,{error:'service_unavailable'});
  const {authorization,fromCookie}=sessionAuth(req);
  if(fromCookie&&!safeOrigin(req))return reply(403,{error:'invalid_origin'});
  try{
    verify??=createLoginVerifier({config,supabaseSecretKey:secret});
    const identity=await verify(authorization);
    if(!identity)return reply(401,{error:'unauthorized'});
    if (!await requireApprovedDevice(req,res,identity,{origin:process.env.SUPABASE_URL,secret})) return;
    const result=await runStep10Restore({
      id:req.query?.id,identity,authorization,body:req.body,
      secret,supabaseOrigin:process.env.SUPABASE_URL
    });
    return reply(result.status,identity.kind==='judge'
      ? {...result.body,restoreDiagnostic:judgeRestoreDiagnostic(result)}
      : result.body);
  }catch{
    return reply(502,{error:'upstream_unavailable'});
  }
}
