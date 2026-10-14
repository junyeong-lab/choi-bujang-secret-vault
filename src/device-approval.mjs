// Stage 11: server-approved opaque device handles, adapted to this app.
// Only SHA-256 fingerprints and the owner's authenticated UUID are stored in DB.
// A browser cannot grant its own approval. No passkey secret or private key is
// generated or serialized by application JavaScript.
import {randomBytes,createHash} from 'node:crypto';
export const DEVICE_COOKIE='__Host-aleph-dv';
const HANDLE=/^[A-Za-z0-9_-]{43}$/u;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const STATUSES=new Set(['pending','approved','revoked']);
const MAX_ACTIVE=5;
const AGE_SECONDS=30*24*60*60;
const digest=text=>createHash('sha256').update(text,'utf8').digest('hex');
export function cookieValue(req,name){
  const raw=(req?.headers?.cookie??'').split(';')
    .map(part=>part.trim()).find(part=>part.startsWith(name+'='));
  const val=raw?.slice(name.length+1);
  return typeof val==='string' && val.length<4096 ? val : null;
}
export function validWriteOrigin(req,appOrigin){
  try{
    const origin=new URL(req.headers.origin),app=new URL(appOrigin);
    return origin.protocol==='https:' && origin.origin===app.origin &&
      req.headers.host===app.host && !origin.username && !origin.password;
  }catch{return false}
}
export async function deviceDb({origin,secret,transport=fetch},method='GET',
    filters={},body){
  const root=new URL(origin);
  if(root.protocol!=='https:'||!root.hostname.endsWith('.supabase.co')||
    root.username||root.password||root.search||root.hash||
    (root.pathname!=='/'&&root.pathname!=='')){
    throw Error('invalid_database_origin');
  }
  if(typeof secret!=='string'||!secret)throw Error('missing_database_secret');
  const url=new URL('/rest/v1/step11_device_handles',root);
  for(const [key,value] of Object.entries(filters))url.searchParams.set(key,String(value));
  const headers={apikey:secret,Accept:'application/json',
    ...(secret.startsWith('eyJ')?{Authorization:'Bearer '+secret}:{})};
  if(body!==undefined){
    headers['Content-Type']='application/json';headers.Prefer='return=representation';
  }
  const res=await transport(url,{method,headers,
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
    redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(!res.ok)throw Error('device_database_unavailable');
  let rows;
  try{rows=await res.json()}catch{rows=null}
  if(!Array.isArray(rows))throw Error('unexpected_device_rows');
  return rows;
}
async function myDevice({req,identity,db}){
  if(!identity||identity.kind!=='student'||!UUID.test(identity.userId))
    return {status:'unregistered',approved:false};
  // A device cookie alone never grants access. Both browser login and
  // authenticated principal must agree; Bearer-only calls are not device proof.
  const login=cookieValue(req,'vault_session');
  const bearer=req.headers?.authorization;
  if(!login||(bearer && bearer!=='Bearer '+login))
    return {status:'unregistered',approved:false};
  const handle=cookieValue(req,DEVICE_COOKIE);
  if(!HANDLE.test(handle??''))return {status:'unregistered',approved:false};
  const rows=await deviceDb(db,'GET',{
    select:'id,status,requested_at,decided_at',
    handle_sha256:'eq.'+digest(handle),
    owner_id:'eq.'+identity.userId,limit:'1'
  });
  const record=rows[0];
  if(!record)return {status:'unregistered',approved:false};
  const status=STATUSES.has(record.status)?record.status:'unregistered';
  return {status,approved:status==='approved',deviceId:record.id};
}
export async function deviceSessionStatus({req,identity,db}){
  return myDevice({req,identity,db});
}
export async function getDeviceStatus({req,identity,db}){
  return myDevice({req,identity,db});
}
export async function requireApprovedDevice(req,res,identity,db){
  try{
    const state=await myDevice({req,identity,db});
    if(state.approved)return true;
    res.status(403).json({error:'device_not_approved'});
    return false;
  }catch{
    res.status(503).json({error:'device_verification_unavailable'});
    return false;
  }
}
export function emptyDeviceBody(raw){
  if(raw===undefined||raw===null||raw==='')return true;
  if(typeof raw==='string'){try{raw=JSON.parse(raw)}catch{return false}}
  return !!raw&&typeof raw==='object'&&!Array.isArray(raw)&&Object.keys(raw).length===0;
}
export async function requestDeviceRegistration({req,identity,db}){
  if(!emptyDeviceBody(req.body))return {code:400,body:{error:'invalid_device_request'}};
  if(!identity||identity.kind!=='student'||!UUID.test(identity.userId)||
    !cookieValue(req,'vault_session'))return {code:401,body:{error:'unauthorized'}};
  // Already registered: same browser, same owner, no duplicate new rows.
  const mine=await myDevice({req,identity,db});
  if(mine.status!=='unregistered')
    return {code:200,body:{status:mine.status,approved:mine.approved,deviceId:mine.deviceId}};
  const existing=await deviceDb(db,'GET',{
    select:'id',owner_id:'eq.'+identity.userId,
    status:'in.(pending,approved)',limit:String(MAX_ACTIVE)
  });
  if(existing.length>=MAX_ACTIVE)return {code:429,body:{error:'device_limit'}};
  const handle=randomBytes(32).toString('base64url');
  const records=await deviceDb(db,'POST',{},{
    owner_id:identity.userId,handle_sha256:digest(handle),status:'pending'
  });
  if(records.length!==1||!UUID.test(records[0].id))
    throw Error('device_registration_failed');
  // HttpOnly means application JS cannot read the opaque handle; its SHA is
  // kept server-side and approval requires a privileged DB action.
  const cookie=DEVICE_COOKIE+'='+handle+
    '; Max-Age='+AGE_SECONDS+'; Path=/; HttpOnly; Secure; SameSite=Strict';
  return {code:201,body:{status:'pending',approved:false,deviceId:records[0].id},cookie};
}
