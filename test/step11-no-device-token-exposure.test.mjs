import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {loginSessionFingerprint,deviceSessionStatus,deviceDb,
  requireApprovedDevice} from '../src/device-approval.mjs';

const base=new URL('../',import.meta.url);
const load=path=>readFileSync(new URL(path,base),'utf8');
const B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const dbSecret='sb_secret_TEST_ONLY_FOR_UNIT_TEST';
const login1='header.payload.signature_one';
const login2='header.payload.signature_two';
const req=token=>({headers:{cookie:'vault_session='+token}});
test('no device key or additional device cookie gets into served JS or responses',()=>{
  const app=load('public/index.html');
  const api=load('api/device.mjs');
  const sessionApi=load('api/auth/session.mjs');
  const server=load('src/device-approval.mjs');
  const worker=load('public/sw.js');
  assert.match(app,/navigator\.credentials\.get/u);
  assert.doesNotMatch(app,/\b(?:localStorage|sessionStorage|indexedDB)\s*[.(\[]/u);
  assert.doesNotMatch(app,/\b(?:BEGIN .*PRIVATE KEY|deviceSessionCookie)\b/u);
  assert.doesNotMatch(api,/Set-Cookie/u);
  assert.doesNotMatch(api,/result\.cookie/u);
  assert.match(sessionApi,/vault_device=; HttpOnly; Secure; SameSite=Strict; Path=\/api; Max-Age=0/u);
  assert.doesNotMatch(server,/deviceSessionCookie/u);
  assert.doesNotMatch(server,/vault_device/u);
  assert.match(worker,/startsWith\('\/api\/'\)/u);
  assert.doesNotMatch(worker,/caches\.(?:open|match)/u);
  assert.doesNotMatch(worker,/\b(?:cache\.put|cache\.add|cache\.addAll)\(/u);
  assert.match(worker,/caches\.delete\(key\)/u);
});
test('server-side verification is bound to existing signed-login context only',()=>{
  const db={secret:dbSecret};
  const a=loginSessionFingerprint({req:req(login1),db});
  const b=loginSessionFingerprint({req:req(login2),db});
  const c=loginSessionFingerprint({req:req(login1),db:{secret:dbSecret+'alternate'}});
  assert.match(a,/^[0-9a-f]{64}$/u);
  assert.notEqual(a,b);
  assert.notEqual(a,c);
  assert.equal(a.includes(login1),false);
  assert.equal(loginSessionFingerprint({req:{headers:{cookie:'vault_device=forged'}},db}),null);
});
test('judge JWT and unverified student logins cannot bypass registered-device gate',async()=>{
  const db={origin:'https://unit.supabase.co',secret:dbSecret,
    transport:async()=>{throw Error('device database should not be accessed')}};
  let codes=[];
  const res={status(code){codes.push(code);return this;},json(){return this;}};
  for(const [identity,request] of [
    [{kind:'judge',userId:B},{headers:{authorization:'Bearer signed.judge.token'}}],
    [{kind:'student',userId:B},{headers:{cookie:'vault_session='+login1}}],
    [{kind:'student',userId:B},{headers:{cookie:'vault_device=forged'}}]
  ]){
    assert.equal(await requireApprovedDevice(request,res,identity,db),false);
  }
  assert.deepEqual(codes,[403,503,403]);
  // A valid student login still requires a server lookup. Database outages
  // fail closed with 503 rather than silently allowing access.
});
test('server session renewal upserts only the HMAC fingerprint, never raw tokens',async()=>{
  let seen;
  const payload=await deviceDb({
    origin:'https://unit.supabase.co',secret:dbSecret,
    transport:async(url,options)=>{
      seen={url:new URL(url),options};
      return new Response(JSON.stringify([{session_sha256:'f'.repeat(64)}]),{status:201});
    }
  },'sessions',{method:'POST',params:{on_conflict:'session_sha256'},body:{
    session_sha256:'f'.repeat(64),
    owner_id:B,credential_row_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    expires_at:'2026-10-14T04:00:00Z'
  }});
  assert.equal(payload.length,1);
  assert.equal(seen.options.headers.Prefer,'resolution=merge-duplicates,return=representation');
  assert.equal(seen.url.searchParams.get('on_conflict'),'session_sha256');
  assert.equal(seen.options.body.includes(login1),false);
});
test('source restores preserve stage 10 judge-only metadata contract without leaking protected reads',()=>{
  const restore=load('api/restore/memo.mjs');
  const targeted=load('api/restore/notes/[id].mjs');
  const memo=load('api/memos.mjs');
  const notice=load('api/notices.mjs');
  assert.match(restore,/identity\.kind==='student'.*requireApprovedDevice/u);
  assert.match(targeted,/identity\.kind==='student'.*requireApprovedDevice/u);
  assert.match(memo,/await requireApprovedDevice/u);
  assert.match(notice,/await requireApprovedDevice/u);
});
