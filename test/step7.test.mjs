import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixtureRequests } from '../scripts/fixture-7.mjs';
import { decide, RULE_IDS } from '../src/decider.mjs';

const { normal, suspicious } = fixtureRequests();
const verify = async (request, expected, code) => {
  const result = await decide(request);
  assert.deepEqual(Object.keys(result).sort(), ['decision', 'reasonCode', 'requestId', 'ruleIds', 'schema']);
  assert.equal(result.decision, expected);
  assert.equal(result.reasonCode, code);
  assert.ok(result.ruleIds.every(id => RULE_IDS.includes(id)));
};
test('registered normal allowed', async () => verify(normal, 'allow', 'approved'));
test('unregistered device denied', async () => verify({ ...suspicious, deviceRegistered: false }, 'deny', 'device_not_registered'));
test('missing registration denied', async () => {
  const request = { ...normal };
  delete request.deviceRegistered;
  await verify(request, 'deny', 'device_not_registered');
});
test('composite anomaly requires step up', async () => verify(suspicious, 'step_up', 'step_up_required'));
test('fresh engine revalidation allows repeated request', async () => verify(
  { ...suspicious, stepUp: { verified: true, authAgeSeconds: 60 } }, 'allow', 'approved'
));
test('stale revalidation does not allow', async () => verify(
  { ...suspicious, stepUp: { verified: true, authAgeSeconds: 700 } }, 'step_up', 'step_up_required'
));
test('region alone is not blocking condition', async () => verify(
  { ...normal, signals: { ...normal.signals, region: 'foreign' } }, 'allow', 'approved'
));
test('forged browser headers never provide risk evidence', async () => verify(
  { ...normal, headers: { 'x-region': 'foreign', 'x-network': 'unusual', 'x-hour': '3' },
    signals: { source: 'none', region: 'foreign', network: 'unusual', hour: 3 },
    recentEvents: suspicious.recentEvents }, 'allow', 'approved'
));
test('missing network not silently treated as known', async () => verify(
  { ...normal, signals: { source: 'judge_fixture', region: 'foreign', hour: 3 },
    recentEvents: suspicious.recentEvents }, 'allow', 'approved'
));
test('untrusted source not accepted', async () => verify(
  { ...normal, signals: { ...suspicious.signals, source: 'client' },
    recentEvents: suspicious.recentEvents }, 'allow', 'approved'
));
test('recent event required for composite risk', async () => verify(
  { ...suspicious, recentEvents: [] }, 'allow', 'approved'
));
