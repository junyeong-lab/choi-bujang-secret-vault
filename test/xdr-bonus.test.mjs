import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const CASES=[
  ['persistence',{block:8,alert:8,record:8}],
  ['privilege',{block:9,alert:8,record:9}],
  ['exfiltration',{block:10,alert:10,record:10}]
];
for(const [key,expected] of CASES) {
  test(key+' independently classifies every fixture alert, no known normal blocks',async()=>{
    const {alerts}=JSON.parse(await readFile(join(root,'xdr','fixtures',key+'.json'),'utf8'));
    const {decide}=await import('../xdr/'+key+'/decide.mjs');
    const result=JSON.parse(await readFile(join(root,'xdr',key,'result.json'),'utf8'));
    assert.equal(result.schema,'aleph.xdr.result.v1');
    assert.equal(result.moduleKey,key);
    assert.deepEqual(result.counts,expected);
    assert.equal(alerts.length,Object.values(expected).reduce((a,b)=>a+b,0));
    assert.deepEqual(result.decisions,alerts.map(a=>({alertId:a.id,...decide(a)})));
    assert.ok(result.decisions.every(d=>d.confidence>=0&&d.confidence<=1&&d.reason.length>0
      &&d.action===(d.confidence>=0.85?'block':d.confidence>=0.5?'alert':'record')));
    assert.ok(alerts.slice(-expected.record).every(a=>decide(a).action==='record'));
    assert.equal(decide(null).action,'record');
    const benign={rule:{level:14,mitre:['T1543','T1053','T1068','T1078','T1041','T1048'],
      description:'수업 문서 조회입니다. 실행·전송·권한 변경은 없습니다.'},
      data:{srcip:'192.0.2.15',dstip:'198.51.100.10',bytes:'4',path:'C:\\lab\\note.txt'}};
    assert.notEqual(decide(benign).action,'block');
  });
  test(key+' patterns embedded; no module I/O',async()=>{
    const {patterns,techniques}=JSON.parse(await readFile(join(root,'xdr',key,'patterns.json'),'utf8'));
    const src=await readFile(join(root,'xdr',key,'decide.mjs'),'utf8');
    assert.ok(techniques.length>=1);
    for(const p of patterns){
      assert.ok(p.name&&p.condition&&p.evidence&&p.reference);
      assert.ok(src.includes(p.name)&&src.includes(p.condition)&&src.includes(p.evidence));
    }
    assert.doesNotMatch(src,/^\s*import\b/m);
    assert.doesNotMatch(src,/\b(?:fetch|readFile|writeFile|appendFile|spawn|eval)\s*\(/);
  });
  test(key+' extraction and redaction',async()=>{
    const {alerts}=JSON.parse(await readFile(join(root,'xdr','fixtures',key+'.json'),'utf8'));
    const {readAlerts,extractAlert}=await import('../xdr/'+key+'/read-alerts.mjs');
    const output=await readAlerts();
    assert.equal(output.length,alerts.length);
    assert.deepEqual(Object.keys(output[0]),['timestamp','sourceAddress','account','ruleLevel','description']);
    const example=extractAlert({timestamp:'2026-10-14',rule:{level:7,description:'token=fictional-test-secret'},
      data:{srcip:'192.0.2.20',srcuser:'user01'}});
    assert.equal(JSON.stringify(example).includes('fictional-test-secret'),false);
  });
  test(key+' responder creates temporary candidate only for block',async()=>{
    const {alerts}=JSON.parse(await readFile(join(root,'xdr','fixtures',key+'.json'),'utf8'));
    const {decide}=await import('../xdr/'+key+'/decide.mjs');
    const {respond,checkTemporaryDeny}=await import('../xdr/'+key+'/respond.mjs');
    const {decideWithXdr}=await import('../xdr/'+key+'/ztna-bridge.mjs');
    const {decide:baseDecide}=await import('../src/decider.mjs');
    const now=Date.UTC(2026,9,14,10,0,0);
    const attack=alerts.find(a=>decide(a).action==='block');
    const unsure=alerts.find(a=>decide(a).action==='alert');
    const normal=alerts.find(a=>decide(a).action==='record');
    assert.equal((await respond(unsure,now)).action,'alert');
    assert.equal(checkTemporaryDeny(unsure.data.srcip,now),null);
    assert.equal((await respond(normal,now)).action,'record');
    assert.equal(checkTemporaryDeny(normal.data.srcip,now),null);
    assert.equal((await respond(attack,now)).action,'block');
    assert.equal(checkTemporaryDeny(attack.data.srcip,now).evidenceAlertId,attack.id);
    const request={schema:'aleph.decision.v1',requestId:key+'-test',deviceRegistered:true,service:'notes',
      method:'GET',path:'/notes/demo',route:'GET /notes/:id',signals:{source:'none'}};
    assert.equal((await baseDecide(request)).decision,'allow');
    assert.equal((await decideWithXdr(request,normal.data.srcip,now)).decision,'allow');
    assert.equal((await decideWithXdr(request,attack.data.srcip,now)).decision,'deny');
    assert.equal(checkTemporaryDeny(attack.data.srcip,now+900000),null);
    assert.equal((await decideWithXdr(request,attack.data.srcip,now+900000)).decision,'allow');
  });
}
