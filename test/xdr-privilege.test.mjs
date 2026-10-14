import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { decide } from '../xdr/privilege/decide.mjs';
import { extractAlert, readAlerts } from '../xdr/privilege/read-alerts.mjs';
import { respond, checkTemporaryDeny } from '../xdr/privilege/respond.mjs';
import { decideWithXdr } from '../xdr/privilege/ztna-bridge.mjs';
import { decide as baseDecide } from '../src/decider.mjs';

const xdrRoot = new URL('../xdr/', import.meta.url);
const loadJSON = async path => JSON.parse(await readFile(new URL(path, xdrRoot), 'utf8'));

test('XDR-05 extracts 26 out of 26 Wazuh alerts with five allowed fields only', async () => {
  const { alerts } = await loadJSON('fixtures/privilege.json');
  const rows = await readAlerts();
  assert.equal(alerts.length, 26);
  assert.equal(rows.length, alerts.length);
  const names = ['timestamp', 'sourceAddress', 'account', 'ruleLevel', 'description'];
  assert.ok(rows.every(item => JSON.stringify(Object.keys(item)) === JSON.stringify(names)));
  const fake = extractAlert({
    timestamp: '2026-10-14', rule: { level: 8, description: 'token=fake-value' },
    data: { srcip: '192.0.2.10', srcuser: 'Bearer fake-value' },
  });
  assert.doesNotMatch(JSON.stringify(fake), /fake-value/);
});

test('XDR-05 patterns provide evidence and decide runs with zero import/I-O', async () => {
  const patterns = await loadJSON('privilege/patterns.json');
  const code = await readFile(new URL('privilege/decide.mjs', xdrRoot), 'utf8');
  assert.deepEqual(patterns.techniques, ['T1068', 'T1078']);
  assert.ok(patterns.patterns.length >= 3);
  for (const pattern of patterns.patterns) {
    assert.ok(pattern.name && pattern.condition && pattern.evidence && pattern.reference);
    assert.ok(code.includes(pattern.name) && code.includes(pattern.condition)
      && code.includes(pattern.evidence));
  }
  assert.doesNotMatch(code, /^\s*import\b/m);
  assert.doesNotMatch(code, /\b(?:fetch|readFile|writeFile|appendFile|execFile|spawn|eval)\s*\(/);
});

test('XDR-05 decides all 26: block 9, alert 8, record 9; normal blocks zero', async () => {
  const { alerts } = await loadJSON('fixtures/privilege.json');
  const recorded = await loadJSON('privilege/result.json');
  const decisions = alerts.map(a => ({ alertId: a.id, ...decide(a) }));
  assert.equal(recorded.schema, 'aleph.xdr.result.v1');
  assert.equal(recorded.moduleKey, 'privilege');
  assert.deepEqual(recorded.counts, { block: 9, alert: 8, record: 9 });
  assert.deepEqual(recorded.decisions, decisions);
  assert.deepEqual(decisions.map(a => a.action), [
    ...Array(9).fill('block'), ...Array(8).fill('alert'), ...Array(9).fill('record'),
  ]);
  assert.ok(decisions.every(d => d.confidence >= 0 && d.confidence <= 1 && d.reason.length > 0
    && d.action === (d.confidence >= 0.85 ? 'block'
      : d.confidence >= 0.5 ? 'alert' : 'record')));
  assert.ok(alerts.slice(17).every(a => decide(a).action === 'record'));
  assert.equal(decide(null).action, 'record');
  assert.equal(decide({}).action, 'record');
  const authorized = {
    rule: { level: 14, mitre: ['T1068', 'T1078'],
      description: '정기 점검: 기존 관리자 계정의 권한 목록 조회 및 수업 문서 열람' },
    data: { srcip: '192.0.2.40', srcuser: 'admin01', group: 'administrators' },
  };
  assert.notEqual(decide(authorized).action, 'block');
});

test('XDR-05 revokes only the evidence-backed account session and expires safely', async () => {
  const { alerts } = await loadJSON('fixtures/privilege.json');
  const now = Date.UTC(2026, 9, 14, 15, 0, 0);
  const attack = alerts[0], questionable = alerts[9], normal = alerts[17];
  assert.equal((await respond(questionable, now)).action, 'alert');
  assert.equal(checkTemporaryDeny(questionable.agent.name, questionable.data.srcuser, now), null);
  assert.equal((await respond(normal, now)).action, 'record');
  assert.equal(checkTemporaryDeny(normal.agent.name, normal.data.srcuser, now), null);
  assert.equal((await respond(attack, now)).action, 'block');
  const rule = checkTemporaryDeny(attack.agent.name, attack.data.srcuser, now);
  assert.equal(rule.evidenceAlertId, attack.id);
  assert.equal(rule.expiresAtMs, now + 900000);
  assert.equal(rule.ruleId, 'xdr.privilege.temporary_session_revoke');

  // Do not use a shared remote IP, other accounts, or an identical name on a different PC.
  assert.equal(checkTemporaryDeny(attack.agent.name, 'unrelated-user', now), null);
  assert.equal(checkTemporaryDeny('another-pc', attack.data.srcuser, now), null);
  assert.equal(checkTemporaryDeny(attack.data.srcip, attack.data.srcuser, now), null);

  const request = {
    schema: 'aleph.decision.v1', requestId: 'xdr-05-test',
    deviceRegistered: true, service: 'notes', method: 'GET',
    path: '/notes/demo', route: 'GET /notes/:id', signals: { source: 'none' },
  };
  assert.equal((await baseDecide(request)).decision, 'allow');
  assert.equal((await decideWithXdr(request, {
    agentName: attack.agent.name, accountName: 'unrelated-user',
  }, now)).decision, 'allow');
  assert.equal((await decideWithXdr(request, {
    agentName: attack.agent.name, accountName: attack.data.srcuser,
  }, now)).decision, 'deny');
  const unregistered = { ...request, deviceRegistered: false };
  assert.deepEqual(
    await decideWithXdr(unregistered, {
      agentName: attack.agent.name, accountName: attack.data.srcuser,
    }, now),
    await baseDecide(unregistered),
  );

  assert.equal(checkTemporaryDeny(attack.agent.name, attack.data.srcuser, now + 900000), null);
  assert.equal((await decideWithXdr(request, {
    agentName: attack.agent.name, accountName: attack.data.srcuser,
  }, now + 900000)).decision, 'allow');
});

test('XDR-05 invalid evidence and missing trusted session mapping never add revocations', async () => {
  const { alerts } = await loadJSON('fixtures/privilege.json');
  const now = Date.UTC(2026, 9, 14, 17, 0, 0);
  assert.equal((await respond({ ...alerts[0], id: null }, now)).action, 'block');
  assert.equal((await respond({ ...alerts[0], data: {
    ...alerts[0].data, srcuser: undefined,
  } }, now)).action, 'block');
  assert.equal(checkTemporaryDeny(alerts[0].agent.name, alerts[0].data.srcuser, now), null);
  const request = { schema: 'aleph.decision.v1', requestId: 'xdr-05-mapping-check',
    deviceRegistered: true, service: 'notes', method: 'GET', path: '/notes/demo',
    route: 'GET /notes/:id', signals: { source: 'none' } };
  assert.deepEqual(await decideWithXdr(request, null, now), await baseDecide(request));
});
