import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { decide } from '../xdr/known-cve/decide.mjs';
import { respond, checkTemporaryDeny } from '../xdr/known-cve/respond.mjs';
import { decideWithXdr } from '../xdr/known-cve/ztna-bridge.mjs';
import { decide as baseDecide } from '../src/decider.mjs';

const fixtureUrl = new URL('../xdr/fixtures/known-cve.json', import.meta.url);
const patternsUrl = new URL('../xdr/known-cve/patterns.json', import.meta.url);
const deciderUrl = new URL('../xdr/known-cve/decide.mjs', import.meta.url);

test('XDR-03 24 fixture alerts classify as 8 block, 8 alert, 8 record', async () => {
  const { alerts } = JSON.parse(await readFile(fixtureUrl, 'utf8'));
  assert.equal(alerts.length, 24);
  const result = alerts.map(decide);
  assert.deepEqual(result.map(r => r.action), [
    ...Array(8).fill('block'), ...Array(8).fill('alert'), ...Array(8).fill('record'),
  ]);
  assert.ok(result.every(r => ['block', 'alert', 'record'].includes(r.action)
    && typeof r.confidence === 'number' && r.confidence >= 0 && r.confidence <= 1
    && typeof r.reason === 'string' && r.reason.length > 0));
  assert.ok(result.filter(r => r.action === 'block').every(r => r.confidence >= 0.85));
  assert.ok(result.filter(r => r.action === 'alert').every(r => r.confidence >= 0.5 && r.confidence < 0.85));
  assert.ok(result.filter(r => r.action === 'record').every(r => r.confidence < 0.5));
});

test('XDR-03 standalone module uses exactly the backed patterns, with no imports', async () => {
  const patterns = JSON.parse(await readFile(patternsUrl, 'utf8'));
  const source = await readFile(deciderUrl, 'utf8');
  assert.equal(patterns.cve, 'CVE-2021-44228');
  assert.equal(patterns.technique, 'T1190');
  for (const pattern of patterns.patterns) {
    assert.ok(pattern.name && pattern.condition && pattern.evidence);
    assert.ok(source.includes(pattern.name) && source.includes(pattern.condition)
      && source.includes(pattern.evidence));
  }
  assert.doesNotMatch(source, /^\s*import\b/m);
  assert.doesNotMatch(source, /\b(?:fetch|readFile|writeFile|execFile|spawn)\s*\(/);
});

test('high severity documentation reference and normal browser event never block', async () => {
  const raw = {
    id: 'synthetic-benign', rule: { level: 14, mitre: ['T1190'],
      description: 'CVE-2021-44228 점검 문서 열람' },
    data: { srcip: '192.0.2.44', url: '/docs/cve-2021-44228' },
  };
  assert.equal(decide(raw).action, 'alert');
  const normal = {
    ...raw, rule: { level: 3, mitre: [], description: '상태 확인' },
  };
  assert.equal(decide(normal).action, 'record');
  assert.equal(decide(null).action, 'record');
});

test('only a confirmed attack creates a temporary rule, then the base policy returns', async () => {
  const { alerts } = JSON.parse(await readFile(fixtureUrl, 'utf8'));
  const now = Date.UTC(2026, 9, 14, 8, 0, 0);
  const attack = alerts[0];
  const doubtful = alerts[8];
  const normal = alerts[16];
  assert.equal((await respond(doubtful, now)).action, 'alert');
  assert.equal(checkTemporaryDeny(doubtful.data.srcip, now), null);
  assert.equal((await respond(normal, now)).action, 'record');
  assert.equal(checkTemporaryDeny(normal.data.srcip, now), null);
  assert.equal((await respond(attack, now)).action, 'block');
  const rule = checkTemporaryDeny(attack.data.srcip, now);
  assert.ok(rule);
  assert.equal(rule.evidenceAlertId, attack.id);
  assert.equal(rule.expiresAtMs, now + 15 * 60 * 1000);
  const request = { schema: 'aleph.decision.v1', requestId: 'xdr-03-test',
    deviceRegistered: true, service: 'notes', method: 'GET', path: '/notes/demo',
    route: 'GET /notes/:id', signals: { source: 'none' } };
  assert.equal((await baseDecide(request)).decision, 'allow');
  assert.equal((await decideWithXdr(request, normal.data.srcip, now)).decision, 'allow');
  assert.equal((await decideWithXdr(request, attack.data.srcip, now)).decision, 'deny');
  assert.equal(checkTemporaryDeny(attack.data.srcip, now + 15 * 60 * 1000), null);
  assert.equal((await decideWithXdr(request, attack.data.srcip, now + 15 * 60 * 1000)).decision, 'allow');
});
