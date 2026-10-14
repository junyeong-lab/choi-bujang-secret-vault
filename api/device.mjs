// Stage 11: server-issued opaque device handle. Enrollment never grants access.
import {readFileSync} from 'node:fs';
import {createLoginVerifier} from '../src/verify-login.mjs';
import {cookieValue,validWriteOrigin,getDeviceStatus,requestDeviceRegistration
} from '../src/device-approval.mjs';
const config=JSON.parse(readFileSync(new URL('../aleph.config.json',import.meta.url),'utf8'));
let verifier;
const error=(res,code,name)=>res.status(code).json({error:name});
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Vary','Cookie');
  if(!['GET','POST'].includes(req.method)){
    res.setHeader('Allow','GET, POST');
    return error(res,405,'method_not_allowed');
  }
  if(req.method==='POST'&&!validWriteOrigin(req,config.publicAppUrl))
    return error(res,403,'invalid_origin');
  const secret=process.env.SUPABASE_SECRET_KEY;
  const origin=process.env.SUPABASE_URL;
  if(!secret||!origin)return error(res,503,'service_unavailable');
  const login=cookieValue(req,'vault_session');
  if(!login)return error(res,401,'unauthorized');
  try{
    verifier??=createLoginVerifier({config,supabaseSecretKey:secret});
    const identity=await verifier('Bearer '+login);
    if(!identity||identity.kind!=='student')return error(res,401,'unauthorized');
    const db={origin,secret};
    if(req.method==='GET')
      return res.status(200).json(await getDeviceStatus({req,identity,db}));
    const result=await requestDeviceRegistration({req,identity,db});
    if(result.cookie)res.setHeader('Set-Cookie',result.cookie);
    return res.status(result.code).json(result.body);
  }catch{
    // Never log a session cookie, device handle, token or private key.
    return error(res,503,'device_verification_unavailable');
  }
}
