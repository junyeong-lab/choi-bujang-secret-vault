import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {OPS_CHECKS,RUNNABLE} from '../src/ops-catalog.mjs';
import {buildOpsView} from '../src/ops-service.mjs';

const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('41 local plan slots never pretend to be official results',()=>{
  assert.equal(OPS_CHECKS.length,41);
  assert.equal(new Set(OPS_CHECKS.map(x=>x.attackId)).size,41);
  assert.ok(OPS_CHECKS.every(x=>x.official===false));
  assert.equal(RUNNABLE.length,10);
  assert.ok(RUNNABLE.every(x=>x.method==='GET'));
});
test('all 41 remain not_run until an actual server observation',()=>{
  const view=buildOpsView({logs:[],snapshots:[],audits:[],devices:[]});
  assert.deepEqual(view.totals,{planned:41,matched:0,mismatched:0,notRun:41,observedRows:0});
  assert.equal(view.officialJudgeResult,'not_run');
  assert.equal(view.revocation.state,'not_run');
});
test('observed API status mismatch stays mismatched',()=>{
  const item=OPS_CHECKS[0];
  const view=buildOpsView({logs:[{attack_id:item.attackId,method:'GET',
    path:item.path,expected:item.expected,observed_http:200,outcome:'mismatched',
    request_id:'synthetic-id',checked_at:'2026-10-14T00:00:00Z',source:'production_http'}]});
  assert.equal(view.totals.mismatched,1);
  assert.equal(view.totals.matched,0);
  assert.equal(view.totals.notRun,40);
  assert.equal(view.checks[0].requestId,view.logs[0].requestId);
});
test('repeated checks show only the newest result in both counters and redacted log',()=>{
  const id=OPS_CHECKS[0].attackId;
  const earlier={attack_id:id,method:'GET',path:'/data.json',
    expected:'HTTP 404',observed_http:404,outcome:'matched',
    request_id:'earlier',checked_at:'2026-10-14T04:00:00Z'};
  const latest={...earlier,observed_http:500,outcome:'mismatched',
    request_id:'latest',checked_at:'2026-10-14T05:00:00Z'};
  const view=buildOpsView({logs:[latest,earlier]});
  assert.equal(view.totals.observedRows,1);
  assert.equal(view.totals.matched,0);
  assert.equal(view.totals.mismatched,1);
  assert.equal(view.logs.length,1);
  assert.equal(view.logs[0].requestId,'latest');
  assert.equal(view.checks[0].requestId,'latest');
});
test('only read-only allowlisted probes and no protected HTTP response content',()=>{
 const code=source('src/ops-service.mjs');
 assert.match(code,/RUNNABLE/);
 assert.match(code,/method:'GET'/);
 assert.match(code,/await response\.body\?\.cancel\(\)/);
 assert.match(code,/runId/);
 assert.doesNotMatch(code,/cache\.put\(/);
});
test('room is login/device restricted and markup contains no real records',()=>{
 const html=source('public/ops.html');
 const script=source('public/ops.js');
 assert.match(html,/41칸은 학생이 작성한 점검 계획/);
 assert.match(html,/id="checks"/);
 assert.match(html,/id="logs"/);
 assert.doesNotThrow(()=>new Script(script));
 assert.doesNotMatch(script,/localStorage|sessionStorage|indexedDB|document\.cookie/);
 assert.match(source('src/ops-handler.mjs'),/requireApprovedDevice/);
 assert.match(source('src/ops-handler.mjs'),/validWriteOrigin/);
});
