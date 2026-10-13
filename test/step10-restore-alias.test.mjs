import assert from 'node:assert/strict';
import { test } from 'node:test';
import alias from '../api/restore.mjs';
import original from '../api/restore/memo.mjs';

test('compatibility route uses the exact same guarded restore handler', () => {
  assert.strictEqual(alias, original);
});

test('compatibility route rejects unsupported GET without accessing any data', async () => {
  const res = {
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  await alias({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.deepEqual(res.body, { error: 'method_not_allowed' });
  assert.equal(res.headers.Allow, 'POST');
});
