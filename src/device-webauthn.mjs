// Minimal, fail-closed WebAuthn ES256 verifier for BYTE BACK stage 11.
// Device private keys remain in the platform/passkey authenticator and never in
// JavaScript or browser storage. This is not managed-device attestation.
import {createHash, createPublicKey, verify as verifySignature, timingSafeEqual} from 'node:crypto';

export const sha256=bytes=>createHash('sha256').update(bytes).digest();
export const digestHex=value=>sha256(value).toString('hex');
export const encode64=value=>Buffer.from(value).toString('base64url');
export function decode64(value,max=8192){
  if(typeof value!=='string'||value.length===0||value.length>max||
     !/^[A-Za-z0-9_-]+$/u.test(value))throw Error('invalid_base64url');
  const buf=Buffer.from(value,'base64url');
  if(encode64(buf)!==value)throw Error('noncanonical_base64url');
  return buf;
}
const checked=(v,expected)=>Buffer.isBuffer(v)&&Buffer.isBuffer(expected)&&
  v.length===expected.length&&timingSafeEqual(v,expected);
export const constantEq=(a,b)=>checked(a,b);

export function cborParse(bytes,offset=0){
  const data=Buffer.from(bytes);
  function read(at,depth=0){
    if(depth>12||at>=data.length)throw Error('bad_cbor');
    const op=data[at++],major=op>>5,info=op&31;
    let count=info;
    if(info===24){if(at+1>data.length)throw Error('bad_cbor');count=data[at++];}
    else if(info===25){if(at+2>data.length)throw Error('bad_cbor');count=data.readUInt16BE(at);at+=2;}
    else if(info===26){if(at+4>data.length)throw Error('bad_cbor');count=data.readUInt32BE(at);at+=4;}
    else if(info>=27)throw Error('unsupported_cbor');
    if(count>1000000)throw Error('oversized_cbor');
    if(major===0)return [count,at];
    if(major===1)return [-count-1,at];
    if(major===2||major===3){
      if(at+count>data.length)throw Error('bad_cbor');
      const v=data.subarray(at,at+count);
      return [major===2?Buffer.from(v):v.toString('utf8'),at+count];
    }
    if(major===4){
      if(count>512)throw Error('bad_cbor');
      const list=[];
      for(let i=0;i<count;i++){let [v,end]=read(at,depth+1);list.push(v);at=end;}
      return [list,at];
    }
    if(major===5){
      if(count>256)throw Error('bad_cbor');
      const map=new Map();
      for(let i=0;i<count;i++){
        const [k,e]=read(at,depth+1);at=e;
        const [v,e2]=read(at,depth+1);at=e2;
        if(map.has(k))throw Error('duplicate_cbor_key');
        map.set(k,v);
      }
      return [map,at];
    }
    if(major===7&&count===20)return [false,at];
    if(major===7&&count===21)return [true,at];
    if(major===7&&count===22)return [null,at];
    throw Error('unsupported_cbor_type');
  }
  return read(offset);
}
function authDataInfo(bytes,rpId,{attested=false}={}){
  const data=Buffer.from(bytes);
  if(data.length<37)throw Error('short_auth_data');
  if(!checked(data.subarray(0,32),sha256(Buffer.from(rpId,'utf8'))))throw Error('wrong_rp_id');
  const flags=data[32];
  if(!(flags&1)||!(flags&4))throw Error('user_presence_or_verification_missing');
  if(attested&&!(flags&0x40))throw Error('missing_attested_credential');
  if(!attested&&(flags&0x40))throw Error('unexpected_attested_credential');
  return {data,flags,signCount:data.readUInt32BE(33)};
}
export function clientData(raw,{challenge,origin,type}){
  const decoded=decode64(raw,8192);
  let data;
  try{data=JSON.parse(decoded.toString('utf8'))}catch{throw Error('invalid_client_json')}
  if(data?.type!==type||data.origin!==origin||
     data.crossOrigin===true||
     !checked(decode64(data.challenge,256),decode64(challenge,256)))
    throw Error('invalid_webauthn_origin_challenge');
  return decoded;
}
export function registrationResult({credential,challenge,origin,rpId}){
  if(credential?.type!=='public-key'||typeof credential.id!=='string'||
     credential.id!==credential.rawId)throw Error('invalid_credential');
  clientData(credential.response?.clientDataJSON,{challenge,origin,type:'webauthn.create'});
  const object=decode64(credential.response?.attestationObject,65536);
  const [attestation,end]=cborParse(object);
  if(end!==object.length||!(attestation instanceof Map)||
     attestation.get('fmt')!=='none'||!(attestation.get('attStmt') instanceof Map)||
     attestation.get('attStmt').size!==0)throw Error('untrusted_attestation');
  const info=authDataInfo(attestation.get('authData'),rpId,{attested:true});
  let at=37+16;
  if(at+2>info.data.length)throw Error('invalid_credential_data');
  const n=info.data.readUInt16BE(at);at+=2;
  if(!n||n>1024||at+n>info.data.length)throw Error('bad_credential_length');
  const credentialId=info.data.subarray(at,at+n);at+=n;
  if(!checked(credentialId,decode64(credential.rawId,2048)))throw Error('credential_mismatch');
  const [cose,finish]=cborParse(info.data,at);
  if(finish!==info.data.length||!(cose instanceof Map)||
     cose.get(1)!==2||cose.get(3)!==-7||cose.get(-1)!==1||
     !Buffer.isBuffer(cose.get(-2))||cose.get(-2).length!==32||
     !Buffer.isBuffer(cose.get(-3))||cose.get(-3).length!==32)
    throw Error('unsupported_credential_key');
  const jwk={kty:'EC',crv:'P-256',x:encode64(cose.get(-2)),
    y:encode64(cose.get(-3)),ext:true,key_ops:['verify']};
  createPublicKey({key:jwk,format:'jwk'}); // Reject invalid curve points.
  return {credentialId:encode64(credentialId),publicKeyJwk:jwk,signCount:info.signCount};
}
export function authenticationResult({credential,challenge,origin,rpId,stored}){
  if(credential?.type!=='public-key'||credential.id!==stored?.credential_id||
     credential.rawId!==stored.credential_id)throw Error('unregistered_credential');
  const rawClient=clientData(credential.response?.clientDataJSON,
    {challenge,origin,type:'webauthn.get'});
  const auth=decode64(credential.response?.authenticatorData,8192);
  const info=authDataInfo(auth,rpId);
  const signature=decode64(credential.response?.signature,2048);
  const key=createPublicKey({key:stored.public_key_jwk,format:'jwk'});
  const signed=Buffer.concat([info.data,sha256(rawClient)]);
  if(!verifySignature('sha256',signed,key,signature))throw Error('invalid_device_signature');
  const before=Number(stored.sign_count);
  if(!Number.isSafeInteger(before)||before<0)throw Error('invalid_sign_count');
  if(before>0&&info.signCount>0&&info.signCount<=before)throw Error('replayed_device_counter');
  return {signCount:Math.max(before,info.signCount)};
}
