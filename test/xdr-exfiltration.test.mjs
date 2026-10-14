import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { decide } from '../xdr/exfiltration/decide.mjs';
import { extractAlert, readAlerts } from '../xdr/exfiltration/read-alerts.mjs';
import { respond, checkTemporaryDeny } from '../xdr/exfiltration/respond.mjs';
import { decideWithXdr } from '../xdr/exfiltration/ztna-bridge.mjs';
import { decide as baseDecide } from '../src/decider.mjs';

const xdrRoot = new URL('../xdr/', import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, xdrRoot), 'utf8'));

test('XDR-06 safely reads all 30 original alerts and emits only five allowed fields', async () => {
  const { alerts } = await json('fixtures/exfiltration.json');
  const rows = await readAlerts();
  assert.equal(alerts.length, 30);
  assert.equal(rows.length, alerts.length);
  const columns = ['timestamp', 'sourceAddress', 'account', 'ruleLevel', 'description'];
  assert.ok(rows.every(r => JSON.stringify(Object.keys(r)) === JSON.stringify(columns)));
  const fake = extractAlert({
    timestamp: '2026-10-14', rule: { level: 8, description: 'token=fictional-test-value' },
    data: { srcip: '192.0.2.1', srcuser: 'Bearer fictional-test-value' },
  });
  assert.doesNotMatch(JSON.stringify(fake), /fictional-test-value/);
});

test('XDR-06 grounded T1041/T1048 patterns and independent no-I/O single-file decide', async () => {
  const patterns = await json('exfiltration/patterns.json');
  const code = await readFile(new URL('exfiltration/decide.mjs', xdrRoot), 'utf8');
  assert.deepEqual(patterns.techniques, ['T1041', 'T1048']);
  assert.ok(patterns.patterns.length >= 3);
  for (const pattern of patterns.patterns) {
    assert.ok(pattern.name && pattern.condition && pattern.evidence && pattern.reference);
    assert.ok(code.includes(pattern.name) && code.includes(pattern.condition)
      && code.includes(pattern.evidence));
  }
  assert.doesNotMatch(code, /^\s*import\b/m);
  assert.doesNotMatch(code, /\b(?:fetch|readFile|writeFile|appendFile|execFile|spawn|eval)\s*\(/);
});

test('XDR-06 classifies 30 alerts: 10 block, 10 alert, 10 record; no normal block', async () => {
  const { alerts } = await json('fixtures/exfiltration.json');
  const result = await json('exfiltration/result.json');
  const decisions = alerts.map(a => ({ alertId: a.id, ...decide(a) }));
  assert.equal(result.schema, 'aleph.xdr.result.v1');
  assert.equal(result.moduleKey, 'exfiltration');
  assert.deepEqual(result.counts, { block: 10, alert: 10, record: 10 });
  assert.deepEqual(result.decisions, decisions);
  assert.deepEqual(decisions.map(a => a.action), [
    ...Array(10).fill('block'),
    ...Array(10).fill('alert'),
    ...Array(10).fill('record'),
  ]);
  assert.ok(decisions.every(d => d.confidence >= 0 && d.confidence <= 1 && d.reason.length > 0
    && d.action === (d.confidence >= 0.85 ? 'block'
      : d.confidence >= 0.5 ? 'alert' : 'record')));
  assert.ok(alerts.slice(20).every(a => decide(a).action === 'record'));
  assert.equal(decide(null).action, 'record');
  assert.equal(decide({}).action, 'record');
  // Seeing a filename without actual transfer must not lead to a block.
  const small = {
    rule: { level: 12, mitre: ['T1048'],
      description: '수업 자료의 압축 파일 이름을 조회했습니다. 외부 전송은 아직 없습니다.' },
    data: { srcip: '192.0.2.2', dstip: '198.51.100.9', bytes: '1000' },
  };
  assert.notEqual(decide(small).action, 'block');
});

test('XDR-06 denies only attack destination, only on affected PC, with 15-min expiry', async () => {
  const { alerts } = await json('fixtures/exfiltration.json');
  const now = Date.UTC(2026, 9, 14, 18, 0, 0);
  const attack = alerts[0], uncertain = alerts[10], normal = alerts[20];
  assert.equal((await respond(uncertain, now)).action, 'alert');
  assert.equal(checkTemporaryDeny(uncertain.agent.name, uncertain.data.dstip, now), null);
  assert.equal((await respond(normal, now)).action, 'record');
  assert.equal(checkTemporaryDeny(normal.agent.name, normal.data.dstip, now), null);
  assert.equal((await respond(attack, now)).action, 'block');
  const rule = checkTemporaryDeny(attack.agent.name, attack.data.dstip, now);
  assert.equal(rule.evidenceAlertId, attack.id);
  assert.equal(rule.ruleId, 'xdr.exfiltration.temporary_destination_deny');
  assert.equal(rule.expiresAtMs, now + 900000);
  assert.equal(checkTemporaryDeny(attack.agent.name, attack.data.srcip, now), null);
  assert.equal(checkTemporaryDeny('other-clean-pc', attack.data.dstip, now), null);

  const request = {
    schema: 'aleph.decision.v1', requestId: 'xdr-06-test',
    deviceRegistered: true, service: 'notes', method: 'GET',
    path: '/notes/demo', route: 'GET /notes/:id', signals: { source: 'none' },
  };
  assert.equal((await baseDecide(request)).decision, 'allow');
  assert.equal((await decideWithXdr(request, {
    agentName: attack.agent.name, destinationIp: normal.data.dstip,
  }, now)).decision, 'allow');
  assert.equal((await decideWithXdr(request, {
    agentName: 'other-clean-pc', destinationIp: attack.data.dstip,
  }, now)).decision, 'allow');
  assert.equal((await decideWithXdr(request, {
    agentName: attack.agent.name, destinationIp: attack.data.dstip,
  }, now)).decision, 'deny');

  const unregistered = { ...request, deviceRegistered: false };
  assert.deepEqual(
    await decideWithXdr(unregistered, {
      agentName: attack.agent.name, destinationIp: attack.data.dstip,
    }, now),
    await baseDecide(unregistered),
  );

  assert.equal(checkTemporaryDeny(attack.agent.name, attack.data.dstip, now + 900000), null);
  assert.equal((await decideWithXdr(request, {
    agentName: attack.agent.name, destinationIp: attack.data.dstip,
  }, now + 900000)).decision, 'allow');
});

test('XDR-06 absent destination or invalid evidence never creates a block entry', async () => {
  const { alerts } = await json('fixtures/exfiltration.json');
  const now = Date.UTC(2026, 9, 14, 19, 0, 0);
  const event = alerts[0];
  assert.equal((await respond({ ...event, id: null }, now)).action, 'block');
  assert.equal((await respond({ ...event, agent: null }, now)).action, 'block');
  assert.equal((await respond({ ...event, data: { ...event.data, dstip: null } }, now)).action, 'alert');
  assert.equal(checkTemporaryDeny(event.agent.name, event.data.dstip, now), null);

  const normalRequest = { schema: 'aleph.decision.v1', requestId: 'xdr-06-invalid',
    deviceRegistered: true, service: 'notes', method: 'GET',
    path: '/notes/demo', route: 'GET /notes/:id', signals: { source: 'none' } };
  assert.deepEqual(await decideWithXdr(normalRequest, null, now), await baseDecide(normalRequest));
});
