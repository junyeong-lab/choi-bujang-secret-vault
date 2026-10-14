// Stage 12: read-only display of server-attested HTTP status records.
// Never render response bodies, note contents or credentials.
const $=id=>document.getElementById(id);
const fmt=t=>typeof t==='string'&&Number.isFinite(Date.parse(t))?
  new Date(t).toLocaleString('ko-KR'):'–';
const literal=v=>v===null||v===undefined?'–':String(v);
function cell(row,value,css) {
  const td=document.createElement('td');
  td.textContent=literal(value);
  if(css)td.className=css;
  row.appendChild(td);
}
function replaceTable(id,items,mapper,colspan){
  const body=$(id);
  body.replaceChildren();
  if(!items.length){
    const tr=document.createElement('tr'),td=document.createElement('td');
    td.colSpan=colspan;td.textContent='확인된 서버 기록 없음';
    tr.appendChild(td);body.appendChild(tr);return;
  }
  for(const item of items){
    const tr=document.createElement('tr');mapper(tr,item);body.appendChild(tr);
  }
}
async function api(method='GET'){
 const r=await fetch('/api/ops',{method,credentials:'same-origin',cache:'no-store',
   ...(method==='POST'?{headers:{'Content-Type':'application/json'},body:'{}'}:{})});
 const data=await r.json().catch(()=>null);
 if(!r.ok)throw new Error(
   r.status===401?'로그인이 필요합니다. 기존 자료실에서 로그인해 주세요.':
   r.status===403?'기기 승인이 필요합니다. 기존 자료실에서 승인 상태를 확인해 주세요.':
   '작전실 서버 요청 오류 (HTTP '+r.status+')');
 return data;
}
function render(d){
 if(d?.schema!=='aleph.ops.room.v1'||!Array.isArray(d.checks)||!Array.isArray(d.logs))
   throw Error('작전실 응답 구조를 확인할 수 없습니다.');
 for(const [field,key] of [['planned','planned'],['matched','matched'],
   ['mismatched','mismatched'],['not-run','notRun'],['logs-count','observedRows']]){
   $(field).textContent=String(d.totals?.[key]??'–');
 }
 $('policy').textContent=(d.policy?.rules??[]).join(' · ')+
   ' / 운영 판정 이력: '+(d.policy?.lastLiveDecision??'미확인');
 $('detect').textContent='실제 탐지 이벤트: '+(d.detection?.lastLiveResult??'미실행');
 $('revoke').textContent='회수 집행 상태: '+(d.revocation?.state??'미실행');
 const x=d.recovery??{};
 $('restore').textContent='사본 '+literal(x.backupCount)+'건 · 최근 사본 '+
   fmt(x.latestBackupAt)+' / 감사 '+literal(x.auditCount)+'건 · 복구 관측 '+literal(x.restorationStatus);
 $('updated').textContent='서버 조회 시각: '+fmt(d.generatedAt)+
  ' · 현재 세션 기기 승인: '+(d.access?.approvedNow?'확인됨':'미확인');
 replaceTable('checks',d.checks,(tr,item)=>{
   cell(tr,item.label);cell(tr,item.kind);
   cell(tr,item.method?item.method+' '+item.path:'실행 방법 미확정');
   cell(tr,item.expected);
   cell(tr,item.observedHttp);
   cell(tr,item.status,'status-'+item.status);
   cell(tr,item.requestId);
   cell(tr,fmt(item.checkedAt));
 },8);
 replaceTable('logs',d.logs,(tr,item)=>{
   cell(tr,item.requestId);cell(tr,fmt(item.checkedAt));
   cell(tr,item.method+' '+item.path);
   cell(tr,item.expected);cell(tr,'HTTP '+item.observedHttp);
   cell(tr,item.status,'status-'+item.status);
 },6);
}
let busy=false;
async function work(run=false){
 if(busy)return;busy=true;
 $('refresh').disabled=true;$('run').disabled=true;
 $('status').textContent=run?'안전한 읽기 요청을 실측하고 있습니다…':'서버 기록을 읽는 중입니다…';
 try{
   if(run)await api('POST');
   const result=await api();
   render(result);
   $('status').textContent=run?'실측 완료. 결과를 서버 기록과 대조했습니다.':'서버 관측 결과를 읽었습니다.';
 }catch(e){
   $('status').textContent=e?.message??'서버 확인에 실패했습니다.';
 }finally{
   busy=false;$('refresh').disabled=false;$('run').disabled=false;
 }
}
$('refresh').addEventListener('click',()=>work());
$('run').addEventListener('click',()=>work(true));
void work();
