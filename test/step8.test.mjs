import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixtureRequests } from '../scripts/fixture-7.mjs';
import { decide } from '../src/decider.mjs';
import { memoResourceId, noticeResourceId } from '../src/resource-ids.mjs';
import { validNotice, noticeAuthorization } from '../src/notice-access.mjs';

const { normal } = fixtureRequests();
const input = (method, path, route) => ({ ...normal, method, path, route, signals: { source: 'none' } });
test('typed resource IDs preserve existing memo IDs', () => {
  assert.equal(memoResourceId('memo123'), 'memo:memo123');
  assert.equal(noticeResourceId('12345678-1234-1234-1234-123456789abc'), 'notice:12345678-1234-1234-1234-123456789abc');
  assert.equal(memoResourceId('../export'), null);
});
test('known exact memo path and route allowed', async () => {
  assert.equal((await decide(input('GET','/api/memos/memo123','GET /api/memos/:id'))).decision, 'allow');
});
test('unknown path fails closed', async () => {
  const r=await decide(input('GET','/api/memos/export','GET /api/memos/export'));
  assert.equal(r.decision, 'deny');
});
test('wrong method/route mismatch fails closed', async () => {
  assert.equal((await decide(input('PUT','/api/memos/memo123','GET /api/memos/:id'))).decision, 'deny');
});
test('registered device remains required', async () => {
  assert.equal((await decide({ ...input('GET','/api/memos/memo123','GET /api/memos/:id'), deviceRegistered:false })).decision, 'deny');
});
test('notice write input validation ignores client role', () => {
  assert.equal(validNotice({title:'공지',body:'연습',role:'instructor'}),true);
  assert.equal(validNotice({title:'',body:'연습'}),false);
});

test('notice API accepts same vault_session cookie as existing session API', () => {
  const req = { headers: { cookie: 'other=1; vault_session=fixture.part.sig; mode=1' } };
  assert.equal(noticeAuthorization(req), 'Bearer fixture.part.sig');
});
test('a browser cookie takes priority over an unrelated authorization header', () => {
  const req = { headers: { cookie: 'vault_session=fixture.part.sig', authorization: 'not-a-bearer' } };
  assert.equal(noticeAuthorization(req), 'Bearer fixture.part.sig');
});
test('engine bearer without cookie is preserved', () => {
  const req = { headers: { authorization: 'Bearer fixture.part.sig' } };
  assert.equal(noticeAuthorization(req), 'Bearer fixture.part.sig');
});
test('requests without cookie or bearer remain unauthenticated', () => {
  assert.equal(noticeAuthorization({ headers: {} }), undefined);
});

const zone = (method, path, route, overrides = {}) => ({ ...input(method, path, route), ...overrides });
const expectZone = async (method, path, route, decision, code) => {
  const result = await decide(zone(method, path, route));
  assert.equal(result.decision, decision, method + ' ' + path);
  assert.equal(result.reasonCode, code, method + ' ' + path);
  assert.deepEqual(Object.keys(result).sort(), ['decision', 'reasonCode', 'requestId', 'ruleIds', 'schema']);
  return result;
};

test('S08_OTHER_ZONE_ALLOWED: memo list GET is denied by decider', async () => {
  const result = await expectZone('GET', '/api/memos', 'GET /api/memos', 'deny', 'resource_not_allowed');
  assert.deepEqual(result.ruleIds, ['resource_zone']);
});
test('S08_OTHER_ZONE_ALLOWED: memo list POST is denied by decider', async () => {
  await expectZone('POST', '/api/memos', 'POST /api/memos', 'deny', 'resource_not_allowed');
});
test('S08_OTHER_ZONE_ALLOWED: instructor notice POST is denied', async () => {
  await expectZone('POST', '/api/notices', 'POST /api/notices', 'deny', 'resource_not_allowed');
});
test('S08_OTHER_ZONE_ALLOWED: instructor notice PUT, DELETE and PATCH are denied', async () => {
  const id = '00000000-0000-4000-8000-000000000000';
  for (const verb of ['PUT', 'DELETE', 'PATCH']) {
    await expectZone(verb, '/api/notices/' + id, verb + ' /api/notices/:id', 'deny', 'resource_not_allowed');
  }
});
test('S08_OTHER_ZONE_ALLOWED: other instructor data writing denied', async () => {
  await expectZone('PUT', '/api/instructor/announcements/notice1', 'PUT /api/instructor/announcements/:id', 'deny', 'resource_not_allowed');
});
test('S08_OTHER_ZONE_ALLOWED: exported/bulk memo pseudo-detail paths denied', async () => {
  for (const id of ['export','all','list','search','bulk','batch','admin','download']) {
    await expectZone('GET','/api/memos/' + id,'GET /api/memos/:id','deny','resource_not_allowed');
  }
});
test('S08_OTHER_ZONE_ALLOWED: another memo listing route denied', async () => {
  await expectZone('GET', '/notes', 'GET /notes', 'deny', 'resource_not_allowed');
});
test('S08_OTHER_ZONE_ALLOWED: forbidden zone still denied after step-up', async () => {
  const { suspicious } = fixtureRequests();
  const result = await decide({ ...suspicious,
    method:'PUT', path:'/api/notices/00000000-0000-4000-8000-000000000000',
    route:'PUT /api/notices/:id', stepUp:{verified:true,authAgeSeconds:60}});
  assert.equal(result.decision,'deny');
  assert.equal(result.reasonCode,'resource_not_allowed');
});
test('S08_OTHER_ZONE_ALLOWED: a single existing memo may be read and updated', async () => {
  await expectZone('GET','/api/memos/sample-note-1','GET /api/memos/:id','allow','approved');
  await expectZone('PUT','/api/memos/sample-note-1','PUT /api/memos/:id','allow','approved');
});
test('S08_OTHER_ZONE_ALLOWED: public notice reading remains permissible', async () => {
  await expectZone('GET','/api/notices','GET /api/notices','allow','approved');
});
