// Server-side device-approval gate. A PWA install, browser-provided device ID,
// user-agent, user-supplied role or login alone never creates device trust.
import {randomBytes} from 'node:crypto';
import {digestHex,encode64,decode64,constantEq,registrationResult,
  authenticationResult} from './device-webauthn.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY=/^[a-f0-9]{64}$/;
const CURRENT_SESSION='vault_device';
const DOMAIN='step11_device_';
const TTL_MS=15*60*1000;
function safeOrigin(value) {
  const url=new URL(value);
  if(url.protocol!=='https:'||!url.hostname.endsWith('.supabase.co')||
    url.port||url.username||url.password||url.search||url.hash||url.pathname!=='/')
    throw Error('invalid_database_origin');
  return url;
}
const apiKeyHeaders=(secret,withBody=false)=>({
  apikey:secret,...(secret.startsWith('eyJ')?{Authorization:'Bearer '+secret}:{}),
  Accept:'application/json',
  ...(withBody?{'Content-Type':'application/json',Prefer:'return=representation'}:{})
});
export async function deviceDb({origin,secret,transport=fetch},resource,{method='GET',params={},body}={}){
  if(!['credentials','challenges','sessions','consume'].includes(resource))
    throw Error('unknown_device_resource');
  if(typeof secret!=='string'||!secret)throw Error('missing_device_database_key');
  const table=resource==='consume'?'rpc/step11_consume_challenge':DOMAIN+resource;
  const url=new URL('/rest/v1/'+table,safeOrigin(origin));
  for(const [name,value] of Object.entries(params))url.searchParams.set(name,String(value));
  const response=await transport(url,{
    method,
    headers:apiKeyHeaders(secret,body!==undefined),
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
    cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)
  });
  if(!response.ok)throw Error('device_database_error');
  let payload;try{payload=await response.json()}catch{payload=null}
  return payload;
}
export function cookieValue(req,name){
  const value=(req?.headers?.cookie??'').split(';').map(x=>x.trim())
    .find(x=>x.startsWith(name+'='))?.slice(name.length+1);
  return typeof value==='string'&&value.length<4096?value:null;
}
export function deviceSessionCookie(token,age=900){
  if(!/^[A-Za-z0-9_-]{20,256}$/u.test(token))throw Error('invalid_session_token');
  return CURRENT_SESSION+'='+token+'; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age='+age;
}
export function clearDeviceSessionCookie(){
  return CURRENT_SESSION+'=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0';
}
export function validWriteOrigin(req,appOrigin){
  try{
    const sent=new URL(req.headers.origin);
    const app=new URL(appOrigin);
    return sent.origin===app.origin&&req.headers.host===app.host&&
      sent.protocol==='https:'&&!sent.username&&!sent.password;
  }catch{return false}
}
export async function deviceSessionStatus({req,identity,db}){
  if(!identity)return {approved:false,status:'unauthorized'};
  // ALEPH verified judge tokens are authenticated independently by signed
  // issuer/audience validation. This avoids rewriting 1–10 judge semantics.
  if(identity.kind==='judge')return {approved:true,status:'judge_verified'};
  if(identity.kind!=='student'||!UUID.test(identity.userId))
    return {approved:false,status:'unauthorized'};
  const cookie=cookieValue(req,CURRENT_SESSION);
  if(!cookie)return {approved:false,status:'verification_required'};
  let bytes;
  try{bytes=decode64(cookie,256)}catch{return {approved:false,status:'verification_required'}}
  if(bytes.length!==32)return {approved:false,status:'verification_required'};
  const hash=digestHex(bytes);
  const now=new Date().toISOString();
  const sessions=await deviceDb(db,'sessions',{params:{
    select:'credential_row_id,owner_id,expires_at',
    session_sha256:'eq.'+hash,owner_id:'eq.'+identity.userId,
    expires_at:'gt.'+now,limit:'1'
  }});
  if(!Array.isArray(sessions)||sessions.length!==1)
    return {approved:false,status:'verification_required'};
  const cred=await deviceDb(db,'credentials',{params:{
    select:'id,status',id:'eq.'+sessions[0].credential_row_id,
    owner_id:'eq.'+identity.userId,status:'eq.approved',limit:'1'
  }});
  return Array.isArray(cred)&&cred.length===1
    ? {approved:true,status:'approved'}
    : {approved:false,status:'verification_required'};
}
export async function requireApprovedDevice(req,res,identity,db){
  try{
    const state=await deviceSessionStatus({req,identity,db});
    if(state.approved)return true;
    res.status(403).json({error:'device_not_approved'});
    return false;
  }catch{
    res.status(503).json({error:'device_verification_unavailable'});
    return false;
  }
}
function stateFromRows(rows){
  if(!Array.isArray(rows))throw Error('invalid_device_rows');
  if(rows.some(x=>x.status==='approved'))return 'verification_required';
  if(rows.some(x=>x.status==='pending'))return 'pending';
  return 'unregistered';
}
export async function getDeviceStatus({req,identity,db}){
  const status=await deviceSessionStatus({req,identity,db});
  if(status.approved)return {status:'approved',approved:true};
  const rows=await deviceDb(db,'credentials',{params:{
    select:'status',owner_id:'eq.'+identity.userId,limit:'20'
  }});
  return {status:stateFromRows(rows),approved:false};
}
function challengeOptions(){
  return {value:encode64(randomBytes(32)),expiresAt:new Date(Date.now()+5*60*1000).toISOString()};
}
async function createChallenge({identity,db,purpose}){
  const options=challengeOptions();
  const rows=await deviceDb(db,'challenges',{method:'POST',body:{
    owner_id:identity.userId,challenge_sha256:digestHex(decode64(options.value)),
    purpose,expires_at:options.expiresAt
  }});
  if(!Array.isArray(rows)||rows.length!==1||!UUID.test(rows[0].id))
    throw Error('challenge_not_created');
  return {challengeId:rows[0].id,challenge:options.value};
}
async function consumeChallenge({identity,db,purpose,challengeId,challenge}){
  if(!UUID.test(challengeId))throw Error('bad_challenge_id');
  const actual=digestHex(decode64(challenge,256));
  const expected=await deviceDb(db,'consume',{method:'POST',body:{
    p_id:challengeId,p_owner_id:identity.userId,p_purpose:purpose
  }});
  if(typeof expected!=='string'||!KEY.test(expected)||
     !constantEq(Buffer.from(actual,'hex'),Buffer.from(expected,'hex')))
    throw Error('invalid_challenge');
}
export async function registerOptions({identity,db,appOrigin}){
  const {hostname}=new URL(appOrigin);
  const request=await createChallenge({identity,db,purpose:'register'});
  // Stable opaque owner handle derived from UUID; never serialize an access token.
  const userHandle=encode64(Buffer.from(identity.userId.replaceAll('-',''),'hex'));
  return {status:'registration_required',...request,publicKey:{
    challenge:request.challenge,rp:{name:'BYTE BACK',id:hostname},
    user:{id:userHandle,name:'BYTE BACK 사용자',displayName:'자료실 사용자'},
    pubKeyCredParams:[{type:'public-key',alg:-7}],timeout:60000,
    attestation:'none',authenticatorSelection:{residentKey:'preferred',userVerification:'required'}
  }};
}
export async function registerFinish({identity,db,appOrigin,body}){
  await consumeChallenge({identity,db,purpose:'register',
    challengeId:body.challengeId,challenge:body.challenge});
  const verified=registrationResult({credential:body.credential,challenge:body.challenge,
    origin:appOrigin,rpId:new URL(appOrigin).hostname});
  const rows=await deviceDb(db,'credentials',{method:'POST',body:{
    owner_id:identity.userId,credential_id:verified.credentialId,
    public_key_jwk:verified.publicKeyJwk,sign_count:verified.signCount,status:'pending'
  }});
  if(!Array.isArray(rows)||rows.length!==1)return {status:'error'};
  // Enrollment is NEVER self-approval. A separate privileged operator must
  // approve the pending record before any protected data is available.
  return {status:'pending',approved:false};
}
export async function verifyOptions({identity,db}){
  const rows=await deviceDb(db,'credentials',{params:{
    select:'credential_id',owner_id:'eq.'+identity.userId,
    status:'eq.approved',limit:'20'
  }});
  if(!Array.isArray(rows)||rows.length===0)return {status:'not_approved'};
  const {challengeId,challenge}=await createChallenge({identity,db,purpose:'verify'});
  return {status:'verification_required',challengeId,challenge,publicKey:{
    challenge,timeout:60000,userVerification:'required',
    allowCredentials:rows.map(x=>({id:x.credential_id,type:'public-key'}))
  }};
}
export async function verifyFinish({identity,db,appOrigin,body}){
  await consumeChallenge({identity,db,purpose:'verify',
    challengeId:body.challengeId,challenge:body.challenge});
  const credId=body?.credential?.rawId;
  if(typeof credId!=='string'||credId.length>2048)return {status:'not_approved'};
  const rows=await deviceDb(db,'credentials',{params:{
    select:'id,owner_id,credential_id,public_key_jwk,sign_count,status',
    credential_id:'eq.'+credId,owner_id:'eq.'+identity.userId,
    status:'eq.approved',limit:'1'
  }});
  if(!Array.isArray(rows)||rows.length!==1)return {status:'not_approved'};
  const current=rows[0];
  const result=authenticationResult({credential:body.credential,challenge:body.challenge,
    origin:appOrigin,rpId:new URL(appOrigin).hostname,stored:current});
  const updated=await deviceDb(db,'credentials',{method:'PATCH',params:{
    id:'eq.'+current.id,owner_id:'eq.'+identity.userId,
    status:'eq.approved',sign_count:'eq.'+current.sign_count
  },body:{sign_count:result.signCount,last_verified_at:new Date().toISOString()}});
  if(!Array.isArray(updated)||updated.length!==1)throw Error('device_counter_changed');
  const rawToken=randomBytes(32);
  const record=await deviceDb(db,'sessions',{method:'POST',body:{
    owner_id:identity.userId,credential_row_id:current.id,
    session_sha256:digestHex(rawToken),
    expires_at:new Date(Date.now()+TTL_MS).toISOString()
  }});
  if(!Array.isArray(record)||record.length!==1)throw Error('device_session_unavailable');
  return {status:'approved',approved:true,cookie:deviceSessionCookie(encode64(rawToken))};
}
