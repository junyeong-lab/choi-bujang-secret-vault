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
