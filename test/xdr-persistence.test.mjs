import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { decide } from '../xdr/persistence/decide.mjs';
import { extractAlert, readAlerts } from '../xdr/persistence/read-alerts.mjs';
import { respond, checkTemporaryDeny } from '../xdr/persistence/respond.mjs';
import { decideWithXdr } from '../xdr/persistence/ztna-bridge.mjs';
import { decide as baseDecide } from '../src/decider.mjs';

const xdrRoot = new URL('../xdr/', import.meta.url);
const getJSON = async path => JSON.parse(await readFile(new URL(path,xdrRoot),'utf8'));

test('XDR-04 reads 24 original alerts and redacts credential-shaped text',async()=>{
 const fixture=await getJSON('fixtures/persistence.json');
 const rows=await readAlerts();
 assert.equal(fixture.alerts.length,24);
 assert.equal(rows.length,24);
 const keys=['timestamp','sourceAddress','account','ruleLevel','description'];
 assert.ok(rows.every(r=>JSON.stringify(Object.keys(r))===JSON.stringify(keys)));
 const fake=extractAlert({timestamp:'2026-10-14',rule:{level:6,description:'token=fake-credential'},
    data:{srcip:'192.0.2.2',srcuser:'Bearer fake-credential'}});
 assert.doesNotMatch(JSON.stringify(fake),/fake-credential/);
});

test('XDR-04 patterns have evidence and classifier needs no imports, I/O or network',async()=>{
 const p=await getJSON('persistence/patterns.json');
 const code=await readFile(new URL('persistence/decide.mjs',xdrRoot),'utf8');
 assert.deepEqual(p.techniques,['T1543','T1053']);
 for(const pattern of p.patterns){
  assert.ok(pattern.name&&pattern.condition&&pattern.evidence&&pattern.reference);
  assert.ok(code.includes(pattern.name)&&code.includes(pattern.condition)&&code.includes(pattern.evidence));
 }
 assert.doesNotMatch(code,/^\s*import\b/m);
 assert.doesNotMatch(code,/\b(?:fetch|readFile|writeFile|appendFile|spawn|execFile|eval)\s*\(/);
});

test('XDR-04 24 decisions: 8 block, 8 alert, 8 record; zero normal blocks',async()=>{
 const fixture=await getJSON('fixtures/persistence.json');
 const saved=await getJSON('persistence/result.json');
 const decisions=fixture.alerts.map(a=>({alertId:a.id,...decide(a)}));
 assert.deepEqual(saved.counts,{block:8,alert:8,record:8});
 assert.equal(saved.schema,'aleph.xdr.result.v1');
 assert.deepEqual(saved.decisions,decisions);
 assert.deepEqual(decisions.map(x=>x.action),[
   ...Array(8).fill('block'),...Array(8).fill('alert'),...Array(8).fill('record')]);
 assert.ok(decisions.every(x=>x.confidence>=0&&x.confidence<=1&&x.reason.length>0
   &&x.action===(x.confidence>=0.85?'block':x.confidence>=0.5?'alert':'record')));
 assert.ok(fixture.alerts.slice(16).every(x=>decide(x).action==='record'));
 const innocent={rule:{level:14,mitre:['T1543','T1053'],
   description:'평소 등록된 정상 예약 작업 자료 열람'},
   data:{srcip:'192.0.2.77',path:'C:\\lab\\normal.cmd'}};
 assert.notEqual(decide(innocent).action,'block');
 assert.equal(decide(null).action,'record');
});

test('XDR-04 temporary quarantine applies only to confirmed infected PC',async()=>{
 const {alerts}=await getJSON('fixtures/persistence.json');
 const now=Date.UTC(2026,9,14,12,0,0);
 const attack=alerts[0],unclear=alerts[8],normal=alerts[16];
 assert.equal((await respond(unclear,now)).action,'alert');
 assert.equal(checkTemporaryDeny(unclear.agent.name,now),null);
 assert.equal((await respond(normal,now)).action,'record');
 assert.equal(checkTemporaryDeny(normal.agent.name,now),null);
 assert.equal((await respond(attack,now)).action,'block');
 const rule=checkTemporaryDeny(attack.agent.name,now);
 assert.equal(rule.evidenceAlertId,attack.id);
 assert.equal(rule.expiresAtMs,now+900000);
 assert.equal(rule.ruleId,'xdr.persistence.temporary_isolation');
 assert.equal(checkTemporaryDeny(attack.data.srcip,now),null);
 const request={schema:'aleph.decision.v1',requestId:'xdr04-test',
   deviceRegistered:true,service:'notes',method:'GET',path:'/notes/demo',
   route:'GET /notes/:id',signals:{source:'none'}};
 assert.equal((await baseDecide(request)).decision,'allow');
 assert.equal((await decideWithXdr(request,'another-clean-pc',now)).decision,'allow');
 assert.equal((await decideWithXdr(request,attack.agent.name,now)).decision,'deny');
 const denied={...request,deviceRegistered:false};
 assert.deepEqual(await decideWithXdr(denied,attack.agent.name,now),await baseDecide(denied));
 assert.equal(checkTemporaryDeny(attack.agent.name,now+900000),null);
 assert.equal((await decideWithXdr(request,attack.agent.name,now+900000)).decision,'allow');
});

test('XDR-04 evidence needs a valid alert id and identifiable PC',async()=>{
 const {alerts}=await getJSON('fixtures/persistence.json');
 const now=Date.UTC(2026,9,14,15,0,0);
 assert.equal((await respond({...alerts[0],id:null},now)).action,'block');
 assert.equal((await respond({...alerts[0],agent:null},now)).action,'block');
 assert.equal(checkTemporaryDeny(alerts[0].agent.name,now),null);
});
