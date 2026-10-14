// Stage 12 protected operations room. Reads/records observation metadata only.
import {readFileSync} from 'node:fs';
import {createLoginVerifier} from '../src/verify-login.mjs';
import {cookieValue,validWriteOrigin,requireApprovedDevice} from '../src/device-approval.mjs';
import {readOps,runReadOnlyChecks} from '../src/ops-service.mjs';
const config=JSON.parse(readFileSync(new URL('../aleph.config.json',import.meta.url),'utf8'));
let verifier;
const fail=(res,code,error)=>res.status(code).json({error});
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('CDN-Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Vary','Cookie');
  if(!['GET','POST'].includes(req.method)){
    res.setHeader('Allow','GET, POST');
    return fail(res,405,'method_not_allowed');
  }
  if(req.method==='POST'){
    if(!validWriteOrigin(req,config.publicAppUrl))
      return fail(res,403,'origin_denied');
    let body=req.body;
    if(typeof body==='string'){try{body=JSON.parse(body)}catch{return fail(res,400,'invalid_json')}}
    if(body!==undefined&&body!==null&&
        (typeof body!=='object'||Array.isArray(body)||Object.keys(body).length>0))
      return fail(res,400,'unexpected_ops_payload');
  }
  const token=cookieValue(req,'vault_session');
  if(!token)return fail(res,401,'login_required');
  const secret=process.env.SUPABASE_SECRET_KEY;
  const origin=process.env.SUPABASE_URL;
  if(!secret||!origin)return fail(res,503,'service_unavailable');
  try{
    verifier??=createLoginVerifier({config,supabaseSecretKey:secret});
    const identity=await verifier('Bearer '+token);
    if(identity?.kind!=='student')return fail(res,401,'login_required');
    const db={origin,secret};
    if(!await requireApprovedDevice(req,res,identity,db))return;
    if(req.method==='GET')
      return res.status(200).json(await readOps({identity,db}));
    // User-triggered only; never mutate memos, policies or restore records.
    const result=await runReadOnlyChecks({req,identity,db,
      appOrigin:config.publicAppUrl});
    return res.status(200).json(result);
  }catch{
    return fail(res,503,'ops_unavailable');
  }
}
