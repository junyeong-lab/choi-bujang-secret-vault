import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash,generateKeyPairSync,sign,randomBytes} from 'node:crypto';
import {registrationResult,authenticationResult,encode64,digestHex} from '../src/device-webauthn.mjs';
import {deviceSessionStatus,requireApprovedDevice,loginSessionFingerprint,
  validWriteOrigin} from '../src/device-approval.mjs';
import {readFileSync} from 'node:fs';

const rp='choi-bujang-secret-vault-pi.vercel.app',origin='https://'+rp;
const B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sha=d=>createHash('sha256').update(d).digest();
const encodeInt=x=>{
  if(x>=0&&x<24)return Buffer.from([x]);
  if(x<0&&x>=-24)return Buffer.from([0x20+(-x-1)]);
  const major=x<0?0x20:0,amount=x<0?-x-1:x;
  return Buffer.from([major+24,amount]);
};
const length=(major,n)=>n<24?Buffer.from([major+n]):
  n<256?Buffer.from([major+24,n]):Buffer.from([major+25,n>>8,n&255]);
function encode(value){
  if(Number.isInteger(value))return encodeInt(value);
  if(Buffer.isBuffer(value))return Buffer.concat([length(0x40,value.length),value]);
  if(typeof value==='string'){const b=Buffer.from(value);return Buffer.concat([length(0x60,b.length),b])}
  if(value instanceof Map){
    const fields=[];for(const [k,v] of value)fields.push(encode(k),encode(v));
    return Buffer.concat([length(0xa0,value.size),...fields]);
  }
  throw Error('unknown_fixture');
}
const credentialId=randomBytes(32);
const {publicKey,privateKey:ephemeralTestSigner}=generateKeyPairSync('ec',{namedCurve:'P-256'});
const jwk=publicKey.export({format:'jwk'});
const rawId=encode64(credentialId);
const challenge=encode64(randomBytes(32));
const rpHash=sha(Buffer.from(rp));
const counter=n=>{const buf=Buffer.alloc(4);buf.writeUInt32BE(n);return buf};
const auth=(flags,n)=>Buffer.concat([rpHash,Buffer.from([flags]),counter(n)]);
const cose=new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x,'base64url')],[-3,Buffer.from(jwk.y,'base64url')]]);
const attested=Buffer.concat([auth(0x45,0),Buffer.alloc(16),Buffer.from([0,32]),credentialId,encode(cose)]);
const registrationObject=encode(new Map([['fmt','none'],['attStmt',new Map()],['authData',attested]]));
const client=(type,site=origin)=>encode64(Buffer.from(JSON.stringify({
  type,challenge,origin:site,crossOrigin:false
})));
test('passkey registration verifies challenge, app origin, RP hash and public key',()=>{
  const result=registrationResult({challenge,origin,rpId:rp,credential:{
    id:rawId,rawId,type:'public-key',response:{
      clientDataJSON:client('webauthn.create'),attestationObject:encode64(registrationObject)
    }
  }});
  assert.equal(result.credentialId,rawId);
  assert.equal(result.publicKeyJwk.x,jwk.x);
  assert.throws(()=>registrationResult({challenge,origin,rpId:'other.example.com',
    credential:{id:rawId,rawId,type:'public-key',response:{
      clientDataJSON:client('webauthn.create'),attestationObject:encode64(registrationObject)
    }}}));
});
test('approved credential must sign a fresh server challenge; wrong origin or signature fails',()=>{
  const authenticatorData=auth(0x05,1),clientData=client('webauthn.get');
  const signature=sign('sha256',Buffer.concat([authenticatorData,sha(Buffer.from(clientData,'base64url'))]),ephemeralTestSigner);
  const credential={id:rawId,rawId,type:'public-key',response:{
    clientDataJSON:clientData,authenticatorData:encode64(authenticatorData),
    signature:encode64(signature)
  }};
  const stored={credential_id:rawId,public_key_jwk:jwk,sign_count:0};
  assert.equal(authenticationResult({credential,challenge,origin,rpId:rp,stored}).signCount,1);
  assert.throws(()=>authenticationResult({credential,challenge,origin,rpId:rp,
    stored:{...stored,sign_count:1}}));
  assert.throws(()=>authenticationResult({credential:{...credential,response:{...credential.response,
    signature:encode64(Buffer.from(signature).fill(0))}},challenge,origin,rpId:rp,stored}));
  assert.throws(()=>authenticationResult({credential,challenge,origin:'https://wrong.example.com',rpId:rp,stored}));
});
test('login / installation or a fake device cookie cannot authorize protected reads',async()=>{
  const identity={kind:'student',userId:B};
  const noCookie={headers:{}};
  const replies=[];
  const res={status:s=>({json:b=>replies.push({status:s,body:b})})};
  assert.equal(await requireApprovedDevice(noCookie,res,identity,{
    origin:'https://unit.supabase.co',secret:'sb_secret_TEST',
    transport:async()=>{throw Error('no db access for absent cookie')}}),false);
  assert.deepEqual(replies[0],{status:403,body:{error:'device_not_approved'}});
  const bogus={headers:{cookie:'vault_device='+encode64(randomBytes(32))}};
  const calls=[];
  const db={origin:'https://unit.supabase.co',secret:'sb_secret_TEST',
    transport:async url=>{
      calls.push(String(url));return new Response('[]',{status:200})
    }};
  assert.deepEqual(await deviceSessionStatus({req:bogus,identity,db}),
    {approved:false,status:'verification_required'});
  assert.equal(calls.length,0);
  // Even a signed judge bearer does NOT prove physical/device enrollment.
  assert.deepEqual(await deviceSessionStatus({req:noCookie,identity:{kind:'judge',userId:B},db}),
    {approved:false,status:'verification_required'});
});
test('only server-approved credential linked to a live HttpOnly session opens access',async()=>{
  const loginJwt='fixtureheader.fixturepayload.fixturesignature';
  const credentialRow='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const req={headers:{cookie:'vault_session='+loginJwt}};
  let status='pending';
  const db={origin:'https://unit.supabase.co',secret:'sb_secret_TEST',transport:async url=>{
    const u=new URL(url);
    if(u.pathname.endsWith('/step11_device_sessions')){
      assert.equal(u.searchParams.get('session_sha256'),'eq.'+
        loginSessionFingerprint({req,db:{secret:'sb_secret_TEST'}}));
      return new Response(JSON.stringify([{owner_id:B,credential_row_id:credentialRow,
        expires_at:new Date(Date.now()+10000).toISOString()}]),{status:200});
    }
    if(u.pathname.endsWith('/step11_device_credentials')){
      return new Response(JSON.stringify(status==='approved'?[{id:credentialRow,status}]:[]),{status:200});
    }
    return new Response('[]',{status:200});
  }};
  assert.equal((await deviceSessionStatus({req,identity:{kind:'student',userId:B},db})).approved,false);
  status='approved';
  assert.equal((await deviceSessionStatus({req,identity:{kind:'student',userId:B},db})).approved,true);
  // A second browser-stored device token must not be issued.
  const legacyOnly={headers:{cookie:'vault_device='+encode64(randomBytes(32))}};
  assert.equal((await deviceSessionStatus({req:legacyOnly,identity:{kind:'student',userId:B},db})).approved,false);
  assert.equal(validWriteOrigin({headers:{origin,host:rp}},origin),true);
  assert.equal(validWriteOrigin({headers:{origin:'https://evil.example.com',host:rp}},origin),false);
});
test('browser UI never persists a device private key/token in JS storage',()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(html,/navigator\.credentials\.create/);
  assert.match(html,/navigator\.credentials\.get/);
  assert.match(html,/if \(!authenticated \|\| !deviceApproved\)/);
  assert.doesNotMatch(html,/(?:localStorage|sessionStorage|indexedDB)\s*[.(\[]/);
  for(const path of ['../api/memos.mjs','../api/memos/[id].mjs',
    '../api/notices.mjs','../api/notices/[id].mjs']){
    const api=readFileSync(new URL(path,import.meta.url),'utf8');
    assert.match(api,/await requireApprovedDevice\(req,res/);
  }
});
