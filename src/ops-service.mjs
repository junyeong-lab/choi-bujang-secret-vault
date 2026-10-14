// Stage 12 operations room: redacted, server-observed HTTP checks only.
// It never reads response bodies of protected APIs and never logs credentials.
import {randomUUID} from 'node:crypto';
import {OPS_CHECKS,RUNNABLE} from './ops-catalog.mjs';
import {RULE_IDS} from './decider.mjs';

const TABLE='step12_ops_checks';
const SOURCE='production_http';
const LIMIT=200;
function dbUrl(origin,table) {
  const root=new URL(origin);
  if(root.protocol!=='https:'||!root.hostname.endsWith('.supabase.co')||
    root.username||root.password||root.port||root.search||root.hash||
    (root.pathname!==''&&root.pathname!=='/'))throw Error('invalid_ops_db_origin');
  return new URL('/rest/v1/'+table,root);
}
export async function opsDb(db,table,{method='GET',params={},body}={}) {
  if(![TABLE,'step10_memo_snapshots','step10_restore_audit','step11_device_handles'].includes(table))
    throw Error('forbidden_ops_table');
  const u=dbUrl(db.origin,table);
  for(const [key,value] of Object.entries(params))u.searchParams.set(key,String(value));
  const headers={apikey:db.secret,Accept:'application/json',
    ...(db.secret.startsWith('eyJ')?{Authorization:'Bearer '+db.secret}:{})};
  if(body!==undefined){headers['Content-Type']='application/json';headers.Prefer='return=minimal';}
  const response=await (db.transport??fetch)(u,{
    method,headers,redirect:'error',cache:'no-store',
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
    signal:AbortSignal.timeout(8000)
  });
  if(!response.ok)throw Error('ops_storage_unavailable');
  if(method==='POST')return [];
  const rows=await response.json();
  if(!Array.isArray(rows))throw Error('invalid_ops_db_data');
  return rows;
}
async function optionalDb(db,table,params){
  try {return await opsDb(db,table,{params});}
  catch{return null;}
}
export function buildOpsView({logs=[],snapshots=null,audits=null,devices=null,now=new Date().toISOString()}={}){
  const latest=new Map();
  const knownIds=new Set(OPS_CHECKS.map(item=>item.attackId));
  // DB query orders descending. Show only the latest real observation for
  // each known check, so summary numbers match the visible redacted log rows.
  // Older append-only rows remain in Supabase for history.
  for(const record of logs){
    if(knownIds.has(record.attack_id)&&!latest.has(record.attack_id))
      latest.set(record.attack_id,record);
  }
  const checks=OPS_CHECKS.map(item=>{
    const e=latest.get(item.attackId);
    return {attackId:item.attackId,label:item.label,kind:item.kind,
      expected:item.expected,method:item.method,path:item.path,
      status:e?.outcome==='matched'||e?.outcome==='mismatched'?e.outcome:'not_run',
      observedHttp:Number.isInteger(e?.observed_http)?e.observed_http:null,
      requestId:e?.request_id??null,checkedAt:e?.checked_at??null,
      source:e?.source??null,official:false};
  });
  const matched=checks.filter(x=>x.status==='matched').length;
  const mismatched=checks.filter(x=>x.status==='mismatched').length;
  const notRun=checks.length-matched-mismatched;
  const safeLogs=[...latest.values()].map(e=>({
    attackId:e.attack_id,method:e.method,path:e.path,
    expected:e.expected,observedHttp:e.observed_http,
    status:e.outcome,requestId:e.request_id,checkedAt:e.checked_at,
    source:SOURCE
  }));
  const approved=Array.isArray(devices)&&devices.some(d=>
    d.status==='approved'&&Date.parse(d.approved_at)<=Date.now()&&Date.parse(d.expires_at)>Date.now());
  return {
    schema:'aleph.ops.room.v1',generatedAt:now,
    scope:'student_plan_not_official_41',officialJudgeResult:'not_run',
    totals:{planned:checks.length,matched,mismatched,notRun,
      observedRows:safeLogs.length},
    policy:{rules:[...RULE_IDS],source:'student_source_code',lastLiveDecision:'not_available'},
    detection:{source:'src/detect.mjs',lastLiveEvent:'not_available',lastLiveResult:'not_run'},
    revocation:{source:'ALEPH SDP engine',state:'not_run',reason:'no_verified_engine_revocation_feed'},
    recovery:{source:'step10_memo_snapshots / step10_restore_audit',
      backupCount:Array.isArray(snapshots)?snapshots.length:null,
      latestBackupAt:Array.isArray(snapshots)&&snapshots.length?snapshots[0].captured_at:null,
      auditCount:Array.isArray(audits)?audits.length:null,
      latestAuditAt:Array.isArray(audits)&&audits.length?audits[0].occurred_at:null,
      restorationStatus:Array.isArray(audits)&&audits.some(x=>x.outcome==='restored')?'observed':'not_run'},
    access:{approvedNow:approved,source:'server_db_status'},
    checks,logs:safeLogs,
    warning:'이는 학생 자체 계획의 41칸이며 공식 41종 공격 결과가 아닙니다. matched도 해당 HTTP 기대값과 일치했다는 의미일 뿐 공식 합격이 아닙니다.'
  };
}
export async function readOps({identity,db}){
  const owner='eq.'+identity.userId;
  const logs=await opsDb(db,TABLE,{params:{
    select:'attack_id,method,path,expected,observed_http,outcome,checked_at,request_id,source',
    owner_id:owner,order:'checked_at.desc,id.desc',limit:String(LIMIT)}});
  const [snapshots,audits,devices]=await Promise.all([
    optionalDb(db,'step10_memo_snapshots',{select:'captured_at',owner_id:owner,order:'captured_at.desc',limit:'100'}),
    optionalDb(db,'step10_restore_audit',{select:'occurred_at,outcome',owner_id:owner,order:'occurred_at.desc',limit:'100'}),
    optionalDb(db,'step11_device_handles',{select:'status,approved_at,expires_at',owner_id:owner,limit:'20'})
  ]);
  return buildOpsView({logs,snapshots,audits,devices});
}
export async function runReadOnlyChecks({req,identity,db,appOrigin,transport=fetch}){
  const app=new URL(appOrigin);
  if(app.protocol!=='https:'||!app.hostname.endsWith('.vercel.app')||
     app.pathname!=='/'||app.search||app.hash||app.username||app.password)throw Error('invalid_ops_app_origin');
  const runId=randomUUID(),records=[];
  for(const check of RUNNABLE){
    const requestId=randomUUID();
    const headers={'Accept':'application/json','X-Ops-Request-Id':requestId};
    if(check.scope==='approved')headers.Cookie=req.headers.cookie??'';
    let observedHttp=599;
    // Exact vetted same-site GET URLs. No arbitrary user URL/method/body is accepted.
    try{
      const target=new URL(check.path,app);
      if(target.origin!==app.origin||target.search||target.hash)throw Error('invalid_target');
      const response=await transport(target,{
        method:'GET',headers,redirect:'manual',cache:'no-store',
        signal:AbortSignal.timeout(10000)
      });
      observedHttp=response.status;
      await response.body?.cancel();
    }catch{
      observedHttp=599; // Not an API success. A failed observation is a mismatch.
    }
    records.push({
      owner_id:identity.userId,run_id:runId,request_id:requestId,
      attack_id:check.attackId,label:check.label,
      expected:check.expected,method:'GET',path:check.path,
      observed_http:observedHttp,
      outcome:observedHttp===check.expectedHttp?'matched':'mismatched',
      source:SOURCE
    });
  }
  await opsDb(db,TABLE,{method:'POST',body:records});
  return {runId,observed:records.length,matched:records.filter(x=>x.outcome==='matched').length,
    mismatched:records.filter(x=>x.outcome==='mismatched').length,
    warning:'HTTP 관측 결과이며 41종 공식 공격 판정이나 쓰기·서명 검증 결과가 아닙니다.'};
}
