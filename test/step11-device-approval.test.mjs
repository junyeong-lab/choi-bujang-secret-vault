import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {deviceSessionStatus,requireApprovedDevice,requestDeviceRegistration,
  cookieValue,DEVICE_COOKIE,validWriteOrigin,emptyDeviceBody
} from '../src/device-approval.mjs';
const OWNER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UID='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const sha=s=>createHash('sha256').update(s).digest('hex');
const user={kind:'student',userId:OWNER};
const identityOther={kind:'student',userId:OTHER};
function fake(rows=[]){
 const calls=[];
 const db={origin:'https://example.supabase.co',secret:['sb','secret',"ONLY_IN_MOCK"].join('_'),
   transport:async(url,opts)=>{
     const u=new URL(url);
     calls.push({method:opts.method,params:Object.fromEntries(u.searchParams),body:opts.body});
     const filter=rows.filter(row=>[...u.searchParams].every(([key,val])=>{
       if(['select','limit'].includes(key))return true;
       if(val.startsWith('in.('))return val.slice(4,-1).split(',').includes(row[key]);
       return String(row[key])===val.replace(/^eq\./,'');
     }));
     if(opts.method==='GET')return new Response(JSON.stringify(filter.slice(0,Number(u.searchParams.get('limit')??99))),{status:200});
     if(opts.method==='POST'){
       const row={id:UID,requested_at:new Date().toISOString(),...JSON.parse(opts.body)};
       rows.push(row);
       return new Response(JSON.stringify([row]),{status:201});
     }
     return new Response('{}',{status:405});
   }};
 return {db,rows,calls};
}
const login='opaque.login.example';
const request=(handle)=>({headers:{
  cookie:'vault_session='+login+(handle?'; '+DEVICE_COOKIE+'='+handle:''),
  host:'choi-bujang-secret-vault-pi.vercel.app',
  origin:'https://choi-bujang-secret-vault-pi.vercel.app'
},body:{}});
test('registration is pending only; secret handle never enters response or DB',async()=>{
 const w=fake();
 assert.equal((await deviceSessionStatus({req:request(),identity:user,db:w.db})).approved,false);
 const result=await requestDeviceRegistration({req:request(),identity:user,db:w.db});
 assert.equal(result.code,201);assert.equal(result.body.status,'pending');
 assert.equal(result.body.approved,false);
 const handle=result.cookie.match(new RegExp(DEVICE_COOKIE+'=([A-Za-z0-9_-]{43})'))?.[1];
 assert.ok(handle);
 assert.match(result.cookie,/HttpOnly; Secure; SameSite=Strict/u);
 assert.match(result.cookie,/Path=\//u);
 assert.ok(!JSON.stringify(result.body).includes(handle));
 assert.ok(!JSON.stringify(w.rows).includes(handle));
 assert.equal(w.rows.length,1);
 assert.equal(w.rows[0].handle_sha256,sha(handle));
 assert.equal(w.rows[0].status,'pending');
 const check=await deviceSessionStatus({req:request(handle),identity:user,db:w.db});
 assert.equal(check.status,'pending');assert.equal(check.approved,false);
 assert.equal((await requestDeviceRegistration({req:request(handle),identity:user,db:w.db})).code,200);
 assert.equal(w.rows.length,1);
});
test('only server-side approved row and matching owner can access protected notes',async()=>{
 const w=fake();const made=await requestDeviceRegistration({req:request(),identity:user,db:w.db});
 const handle=made.cookie.match(new RegExp(DEVICE_COOKIE+'=([A-Za-z0-9_-]{43})'))[1];
 const req=request(handle);
 const checks=[];const res={status(code){this.code=code;return this;},json(o){checks.push(o);}};
 assert.equal(await requireApprovedDevice(req,res,user,w.db),false);
 assert.equal(res.code,403);assert.deepEqual(checks[0],{error:'device_not_approved'});
 // A bare badge without operator approval timestamp cannot unlock notes.
 w.rows[0].status='approved';
 assert.equal(await requireApprovedDevice(req,res,user,w.db),false);
 w.rows[0].approved_at=new Date().toISOString(); // privileged administrator only
 assert.equal(await requireApprovedDevice(req,res,user,w.db),true);
 assert.equal((await deviceSessionStatus({req,identity:identityOther,db:w.db})).approved,false);
 assert.equal(await requireApprovedDevice(req,res,identityOther,w.db),false);
 assert.equal((await deviceSessionStatus({req:{headers:{authorization:'Bearer signed.judge.token',cookie:req.headers.cookie}},
   identity:{kind:'judge',userId:OWNER},db:w.db})).approved,false);
 w.rows[0].status='revoked';
 assert.equal((await deviceSessionStatus({req,identity:user,db:w.db})).approved,false);
});
test('approval parameters and mismatched login cookies do not grant device access',async()=>{
 const w=fake();
 for(const body of [{status:'approved'},{deviceId:UID},{role:'admin'},'not json',[{}]]){
   assert.equal((await requestDeviceRegistration({req:{...request(),body},identity:user,db:w.db})).code,400);
 }
 assert.equal(w.rows.length,0);
 assert.equal(emptyDeviceBody('{}'),true);
 assert.equal(emptyDeviceBody({}),true);
 assert.equal(emptyDeviceBody({approved:true}),false);
 assert.equal(validWriteOrigin(request(),'https://choi-bujang-secret-vault-pi.vercel.app'),true);
 assert.equal(validWriteOrigin({...request(),headers:{...request().headers,origin:'https://fake.example'}},
  'https://choi-bujang-secret-vault-pi.vercel.app'),false);
 const res=await requestDeviceRegistration({req:request(),identity:user,db:w.db});
 const handle=res.cookie.match(new RegExp(DEVICE_COOKIE+'=([A-Za-z0-9_-]{43})'))[1];
 w.rows[0].status='approved';
 assert.equal((await deviceSessionStatus({req:{headers:{cookie:DEVICE_COOKIE+'='+handle}},
   identity:user,db:w.db})).approved,false);
 assert.equal((await deviceSessionStatus({req:{headers:{cookie:'vault_session='+login+'; '+DEVICE_COOKIE+'='+handle,
   authorization:'Bearer fake.other.jwt'}},identity:user,db:w.db})).approved,false);
});
test('expired or future-dated approvals remain denied even with a valid device handle',async()=>{
 const w=fake();const made=await requestDeviceRegistration({req:request(),identity:user,db:w.db});
 const handle=made.cookie.match(new RegExp(DEVICE_COOKIE+'=([A-Za-z0-9_-]{43})'))[1];
 const req=request(handle);
 w.rows[0].status='approved';
 w.rows[0].approved_at=new Date(Date.now()+60000).toISOString();
 assert.equal((await deviceSessionStatus({req,identity:user,db:w.db})).approved,false);
 w.rows[0].approved_at=new Date().toISOString();
 assert.equal((await deviceSessionStatus({req,identity:user,db:w.db})).approved,true);
 w.rows[0].expires_at=new Date(Date.now()-1000).toISOString();
 const expired=await deviceSessionStatus({req,identity:user,db:w.db});
 assert.equal(expired.status,'expired');
 assert.equal(expired.approved,false);
 const res={status(code){this.code=code;return this;},json(){}};
 assert.equal(await requireApprovedDevice(req,res,user,w.db),false);
 assert.equal(res.code,403);
});
test('server failures do not grant access',async()=>{
 const w=fake();
 const made=await requestDeviceRegistration({req:request(),identity:user,db:w.db});
 const handle=made.cookie.match(new RegExp(DEVICE_COOKIE+'=([A-Za-z0-9_-]{43})'))[1];
 const res={status(code){this.code=code;return this;},json(){}};
 const broken={...w.db,transport:async()=>new Response('{}',{status:502})};
 assert.equal(await requireApprovedDevice(request(handle),res,user,broken),false);
 assert.equal(res.code,503);
});
