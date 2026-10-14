import {readFileSync} from 'node:fs';
import {createLoginVerifier} from '../src/verify-login.mjs';
import {cookieValue,validWriteOrigin,getDeviceStatus,
  registerOptions,registerFinish,verifyOptions,verifyFinish
} from '../src/device-approval.mjs';

const config=JSON.parse(readFileSync(new URL('../aleph.config.json',import.meta.url),'utf8'));
let cachedVerifier;
const err=(res,status,error)=>res.status(status).json({error});

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Vary','Cookie');
  if(!['GET','POST'].includes(req.method)){
    res.setHeader('Allow','GET, POST');
    return err(res,405,'method_not_allowed');
  }
  const secret=process.env.SUPABASE_SECRET_KEY;
  const origin=process.env.SUPABASE_URL;
  if(!secret||!origin)return err(res,503,'service_unavailable');
  if(req.method==='POST'&&!validWriteOrigin(req,config.publicAppUrl))
    return err(res,403,'invalid_origin');
  const jwt=cookieValue(req,'vault_session');
  const authorization=jwt?'Bearer '+jwt:undefined;
  if(!authorization)return err(res,401,'unauthorized');
  try{
    cachedVerifier??=createLoginVerifier({config,supabaseSecretKey:secret});
    const identity=await cachedVerifier(authorization);
    if(identity?.kind!=='student')return err(res,401,'unauthorized');
    const db={origin,secret};
    if(req.method==='GET'){
      const state=await getDeviceStatus({req,identity,db});
      return res.status(200).json(state);
    }
    let input=req.body;
    if(typeof input==='string'){try{input=JSON.parse(input)}catch{return err(res,400,'invalid_json')}}
    if(!input||typeof input!=='object'||Array.isArray(input)||
       typeof input.action!=='string')return err(res,400,'invalid_request');
    const permitted={
      'register-options':['action'],
      'register-finish':['action','challenge','challengeId','credential'],
      'verify-options':['action'],
      'verify-finish':['action','challenge','challengeId','credential']
    };
    const expected=permitted[input.action];
    if(!expected||Object.keys(input).some(key=>!expected.includes(key)))
      return err(res,400,'invalid_request');
    if(input.action==='register-options'){
      const result=await registerOptions({identity,db,appOrigin:config.publicAppUrl});
      return res.status(200).json(result);
    }
    if(input.action==='register-finish'){
      const result=await registerFinish({identity,db,appOrigin:config.publicAppUrl,body:input});
      return res.status(200).json(result);
    }
    if(input.action==='verify-options'){
      const result=await verifyOptions({identity,db});
      return res.status(200).json(result);
    }
    const result=await verifyFinish({identity,db,appOrigin:config.publicAppUrl,body:input});
    if(result.cookie){
      res.setHeader('Set-Cookie',result.cookie);
      delete result.cookie;
    }
    return res.status(200).json(result);
  }catch(error){
    if(['invalid_challenge','invalid_credential','wrong_rp_id',
      'invalid_webauthn_origin_challenge','invalid_device_signature',
      'user_presence_or_verification_missing','untrusted_attestation',
      'unsupported_credential_key','credential_mismatch',
      'replayed_device_counter','unregistered_credential'].includes(error?.message))
      return err(res,403,'device_verification_failed');
    if(error?.message==='device_database_error')return err(res,503,'device_verification_unavailable');
    // No raw exception, user ID, private key, JWT or challenge leaked to clients/logs.
    return err(res,403,'device_verification_failed');
  }
}
