// Stage 10 optional judge-provided private backup. No contents or secrets go to
// git, logs, public endpoints, audit rows, or the response.
import {createHash,timingSafeEqual} from 'node:crypto';
const SHA=/^[0-9a-f]{64}$/i;
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
function sameHash(a,b){
  return typeof a==='string' && typeof b==='string' &&
    SHA.test(a) && SHA.test(b) &&
    timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
}
const deny=(status,error)=>({status,body:{error}});
export function verifiedEnvMemo({raw,integrityHash,id,ownerId}){
  if(raw===undefined && integrityHash===undefined) return deny(503,'backup_unavailable');
  if(typeof raw!=='string'||!raw||raw.length>1024*1024 ||
      typeof integrityHash!=='string'||!sameHash(sha(raw),integrityHash)) {
    return deny(409,'backup_invalid');
  }
  let copy;
  try {
    const envelope=JSON.parse(raw);
    if(Array.isArray(envelope)){
      if(envelope.length!==1) return deny(409,'backup_invalid');
      copy=envelope[0];
    } else if(envelope && typeof envelope==='object') {
      copy=envelope.note??envelope.memo??envelope.backup??envelope;
      if(Array.isArray(envelope.notes)||Array.isArray(envelope.memos)) {
        const rows=envelope.notes??envelope.memos;
        if(rows.length!==1) return deny(409,'backup_invalid');
        copy=rows[0];
      }
    }
  } catch { return deny(409,'backup_invalid'); }
  if(!copy||typeof copy!=='object'||Array.isArray(copy)) return deny(409,'backup_invalid');
  const memoId=copy.id??copy.memoId??copy.noteId??copy.memo_id??copy.note_id;
  const owner=copy.owner_id??copy.ownerId??copy.owner;
  const title=copy.title;
  const body=copy.body??copy.content;
  const claimedHash=copy.content_sha256??copy.contentSha256??copy.bodySha256??copy.body_sha256;
  if(typeof memoId!=='string'||!ID.test(memoId)||!UUID.test(owner)||
      typeof title!=='string'||title.length>160||
      typeof body!=='string'||body.length>10000||
      !SHA.test(claimedHash??'')) return deny(409,'backup_invalid');
  if(memoId!==id) return deny(404,'backup_not_found');
  if(owner.toLowerCase()!==ownerId.toLowerCase()) return deny(403,'not_owner');
  const contentHash=sha(body);
  const titledHash=sha(title+'\u0000'+body);
  if(!sameHash(claimedHash,contentHash)&&!sameHash(claimedHash,titledHash)) {
    return deny(409,'backup_invalid');
  }
  return {status:200,memo:{id:memoId,ownerId:owner,title,body,
    claimedHash:claimedHash.toLowerCase(),contentSha256:contentHash,
    hashScope:sameHash(claimedHash,titledHash)?'title_body':'body'}};
}

function apiHeaders(key,extras={}){
  return {apikey:key,...(key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{}),
    Accept:'application/json',...extras};
}
async function rest(origin,key,table,method,filters,body,transport){
  const url=new URL('/rest/v1/'+table,origin);
  for(const [k,v] of Object.entries(filters??{}))url.searchParams.set(k,v);
  const headers=apiHeaders(key,body===undefined?{}:{'Content-Type':'application/json'});
  if(method==='POST'||method==='PATCH')headers.Prefer='return=representation';
  const res=await transport(url,{
    method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),
    cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)
  });
  if(!res?.ok)return {ok:false,status:res?.status??0};
  let rows;try{rows=await res.json()}catch{rows=null}
  return {ok:true,status:res.status,rows};
}
// Strictly one memo row is inserted or patched. Only the dedicated immutable
// audit table may receive an additional row; all other tables/policies untouched.
// A failed audit never yields a fake successful restore.
export async function restoreFromEnv({
  raw,integrityHash,id,ownerId,supabaseOrigin,secret,transport=fetch
}){
  if(typeof id!=='string'||!ID.test(id)||typeof ownerId!=='string'||!UUID.test(ownerId)){
    return deny(400,'invalid_restore_request');
  }
  const verified=verifiedEnvMemo({raw,integrityHash,id,ownerId});
  if(verified.status!==200)return verified;
  const memo=verified.memo;
  if(typeof secret!=='string'||!secret||typeof supabaseOrigin!=='string')
    return deny(503,'service_unavailable');
  let origin;
  try {
    origin=new URL(supabaseOrigin);
    if(origin.protocol!=='https:'||!origin.hostname.endsWith('.supabase.co')||
       origin.username||origin.password||origin.search||origin.hash)throw Error('origin');
  }catch{return deny(503,'service_unavailable');}
  try{
    const existing=await rest(origin,secret,'vault_memos','GET',{
      select:'id,owner_id,title,content',id:'eq.'+id,limit:'2'
    },undefined,transport);
    if(!existing.ok||!Array.isArray(existing.rows)||existing.rows.length>1)
      return deny(502,'upstream_unavailable');
    const current=existing.rows[0];
    if(current && String(current.owner_id).toLowerCase()!==ownerId.toLowerCase())
      return deny(403,'not_owner');
    const oldHash=current?sha(String(current.content)):'absent';
    // Record the real, verified start BEFORE touching the note. If audit
    // storage is unavailable, leave the note unchanged (fail closed).
    const started=await rest(origin,secret,'step10_restore_audit','POST',{},{
      memo_id:id,owner_id:ownerId,before_sha256:oldHash,
      after_sha256:memo.contentSha256,outcome:'started'
    },transport);
    if(!started.ok||!Array.isArray(started.rows)||started.rows.length!==1)
      return deny(503,'audit_unavailable');
    if(!current) {
      const created=await rest(origin,secret,'vault_memos','POST',{},{
        id,owner_id:ownerId,title:memo.title,content:memo.body
      },transport);
      if(!created.ok)return deny(created.status===409?409:502,'restore_failed');
    }else if(current.title!==memo.title||current.content!==memo.body){
      const applied=await rest(origin,secret,'vault_memos','PATCH',{
        id:'eq.'+id,owner_id:'eq.'+ownerId
      },{title:memo.title,content:memo.body},transport);
      if(!applied.ok||!Array.isArray(applied.rows)||applied.rows.length!==1)
        return deny(502,'restore_failed');
    }
    const check=await rest(origin,secret,'vault_memos','GET',{
      select:'id,owner_id,title,content',id:'eq.'+id,owner_id:'eq.'+ownerId,
      limit:'2'
    },undefined,transport);
    if(!check.ok||!Array.isArray(check.rows)||check.rows.length!==1)
      return deny(502,'readback_failed');
    const row=check.rows[0];
    if(row.id!==id||row.owner_id?.toLowerCase()!==ownerId.toLowerCase()||
       row.title!==memo.title||!sameHash(sha(row.content),memo.contentSha256))
      return deny(502,'readback_failed');
    const audit=await rest(origin,secret,'step10_restore_audit','POST',{},{
      memo_id:id,owner_id:ownerId,before_sha256:oldHash,
      after_sha256:memo.contentSha256,outcome:'restored'
    },transport);
    if(!audit.ok||!Array.isArray(audit.rows)||audit.rows.length!==1)
      return deny(503,'audit_unavailable');
    return {status:200,body:{
      status:'restored',id,memoId:id,ownerId,ownerVerified:true,
      ownerMatched:true,restored:true,applied:true,
      created:!current,contentSha256:memo.claimedHash,contentHash:memo.claimedHash,
      bodySha256:memo.contentSha256,backupVerified:true,auditRecorded:true
    }};
  }catch{return deny(502,'upstream_unavailable');}
}
