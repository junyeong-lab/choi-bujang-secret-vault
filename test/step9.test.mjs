import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detect } from '../src/detect.mjs';

const origin = Date.UTC(2026, 9, 1, 0, 0, 0);
const make = (count, subject = 'learner_fixture', gapSeconds = 2, offsetSeconds = 0) =>
  Array.from({ length: count }, (_, i) => ({
    at: new Date(origin + (offsetSeconds + i * gapSeconds) * 1000).toISOString(),
    method: 'GET',
    identity: { sub: subject },
  }));
const observe = { action: 'observe' };
const proposal = subject => ({ action: 'propose_revocation', reasonCode: 'burst_read', subject });

test('empty events and normal traffic are observed without extra fields', () => {
  assert.deepEqual(detect([]), observe);
  assert.deepEqual(detect(make(30)), observe);
});
test('exact threshold 120 is observe, 121 triggers one proposal', () => {
  assert.deepEqual(detect(make(120)), observe);
  assert.deepEqual(detect(make(121)), proposal('learner_fixture'));
});
test('GET 200 spread over more than ten minutes is normal', () => {
  assert.deepEqual(detect(make(200, 'learner_fixture', 7)), observe);
});
test('mixing two identities never creates a combined 121-read burst', () => {
  const a = make(100, 'alpha');
  const b = make(100, 'beta');
  assert.deepEqual(detect([...a, ...b].sort((x, y) => x.at.localeCompare(y.at))), observe);
});
test('single abnormal identity does not propose revocation for normal neighbor', () => {
  const a = make(121, 'abnormal');
  const b = make(100, 'normal');
  assert.deepEqual(detect([...a, ...b]), proposal('abnormal'));
});
test('input ordering does not change window arithmetic', () => {
  assert.deepEqual(detect(make(121).reverse()), proposal('learner_fixture'));
});
test('POST and PUT events are never counted as GET', () => {
  const extra = make(220).map(e => ({ ...e, method: 'POST' }));
  assert.deepEqual(detect([...make(60), ...extra]), observe);
});
test('events outside any ten-minute window never combine', () => {
  assert.deepEqual(detect([...make(100), ...make(100,'learner_fixture',2,2000)]), observe);
});
test('crossing can happen in a later sliding window', () => {
  assert.deepEqual(detect([...make(40,'learner_fixture',2,-1600), ...make(121)]), proposal('learner_fixture'));
});
test('invalid events and unverified or missing subject are ignored', () => {
  const extras = [{ at: 'bad', method: 'GET', identity: { sub: 'learner_fixture' } },
    { at: new Date(origin).toISOString(), method: 'GET' },
    null, {}, { method:'GET', identity:{ sub: '' }, at:new Date(origin).toISOString() }];
  assert.deepEqual(detect([...make(120), ...extras]), observe);
});
test('sensitive content is never copied into the separate detection result', () => {
  const events = make(121).map(e => ({ ...e, body: 'TEST_PRIVATE_MEMO', token:'TEST_TOKEN', name:'TEST_REAL_NAME' }));
  const result = detect(events);
  assert.deepEqual(result, proposal('learner_fixture'));
  assert.equal(JSON.stringify(result).includes('TEST_PRIVATE_MEMO'), false);
  assert.equal(JSON.stringify(result).includes('TEST_TOKEN'), false);
});
test('reject non-array detector input', () => {
  assert.throws(() => detect(null), { name:'TypeError', message:'invalid_detection_events' });
});
