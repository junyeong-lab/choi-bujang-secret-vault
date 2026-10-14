import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import original from '../api/restore/memo.mjs';

const config=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));

test('previous POST /api/restore compatibility route rewrites to the same verified handler',()=>{
  assert.ok(config.rewrites.some(route=>
    route.source==='/api/restore' && route.destination==='/api/restore/memo'));
});
test('rewritten handler still rejects unsupported GET without accessing data',async()=>{
  const res={
    headers:{},
    setHeader(key,value){this.headers[key]=value;},
    status(code){this.statusCode=code;return this;},
    json(body){this.body=body;return this;}
  };
  await original({method:'GET',headers:{}},res);
  assert.equal(res.statusCode,405);
  assert.deepEqual(res.body,{error:'method_not_allowed'});
  assert.equal(res.headers.Allow,'POST');
});
