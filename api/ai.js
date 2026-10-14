// Unimplemented AI endpoint stays 501. The 12th-function slot is reused
// for Stage 12 ops to stay within the Vercel Hobby 12-function deployment limit.
import opsHandler from '../src/ops-handler.mjs';
export default function handler(request,response){
  if(request.query?.__ops==='step12')return opsHandler(request,response);
  response.setHeader('Cache-Control','no-store');
  return response.status(501).json({error:'AI_PROXY_NOT_IMPLEMENTED'});
}
