import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { runPostRestoreRetests } from '../src/restore-retest.mjs';
import { attachPostRestoreRetests } from '../api/restore/memo.mjs';

const memoId='sample-note-5';
const body='SYNTHETIC_STUDENT_B_SAMPLE';
const hash=createHash('sha256').update(body).digest('hex');
const authorization='Bearer SYNTHETIC_TEST_ONLY';
const publicAppUrl='https://choi-bujang-secret-vault-pi.vercel.app';
const committed={status:200,body:{status:'restored',memoId,ownerMatched:true,contentSha256:hash}};
const testContext={authorization,memoId,expectedContentHash:hash,publicAppUrl};

function fakeTransport(overrides={}) {
  const calls=[];
  const transport=async(url,options)=>{
    const path=new URL(url).pathname;
    calls.push({path,method:options.method,withAuth:!!options.headers.Authorization});
    const status=overrides[path]??(path==='/api/memos/'+memoId?200:
      path==='/api/memos/sample-note-1'?404:
      path==='/api/memos'?401:
      path==='/api/notices'?403:0);
    return {status,json:async()=>({id:memoId,body})};
  };
  return {calls,transport};
}
test('retest executes actual four HTTP probes and real policy functions only after commit',async()=>{
  const {calls,transport}=fakeTransport();
  const r=await runPostRestoreRetests({...testContext,transport});
  assert.equal(r.status,'passed');
  assert.equal(r.checks.length,10);
  assert.equal(r.checks.every(x=>x.result==='passed'),true);
  assert.equal(calls.length,4);
  assert.equal(calls.find(x=>x.path==='/api/memos').withAuth,false);
  assert.equal(calls.find(x=>x.path==='/api/memos/'+memoId).withAuth,true);
  assert.equal(JSON.stringify(r).includes(body),false);
  assert.equal(JSON.stringify(r).includes(authorization),false);
});
test('unexpected failed owner, zone and notice responses are reported as failed, never passed',async()=>{
  const {transport}=fakeTransport({['/api/memos/'+memoId]:404,
    '/api/memos/sample-note-1':200,'/api/notices':200});
  const r=await runPostRestoreRetests({...testContext,transport});
  assert.equal(r.status,'failed');
  assert.equal(r.checks.filter(x=>x.result==='failed').length,3);
});
test('no restored memo or invalid signature context makes post-restore check fail',async()=>{
  const r=await runPostRestoreRetests({...testContext,authorization:undefined});
  assert.equal(r.status,'failed');
  assert.equal(r.checks[0].result,'failed');
});
test('preview, unauthorized and failed restoration do NOT claim post-restore retests',async()=>{
  let calls=0;
  const stub=async()=>{calls++;return {status:'passed',checks:[{id:'x',result:'passed'}]};};
  for(const candidate of [
    {status:200,body:{status:'preview'}},
    {status:404,body:{error:'backup_not_found'}},
    {status:409,body:{error:'backup_invalid'}}
  ]) {
    assert.deepEqual(await attachPostRestoreRetests({
      restoreResult:candidate,authorization,memoId,publicAppUrl,retester:stub
    }),candidate);
  }
  assert.equal(calls,0);
});
test('COMMITTED restoration triggers retest; only real retest results are returned',async()=>{
  let calls=0;
  const retester=async input=>{
    calls++;
    assert.equal(input.expectedContentHash,hash);
    assert.equal(input.memoId,memoId);
    return {status:'passed',checks:[{id:'real_http_probe',result:'passed',observed:'HTTP_200'}]};
  };
  const r=await attachPostRestoreRetests({
    restoreResult:committed,authorization,memoId,publicAppUrl,retester
  });
  assert.equal(calls,1);
  assert.equal(r.body.status,'restored');
  assert.equal(r.body.postRestoreRetest.status,'passed');
  assert.equal(r.body.postRestoreRetest.checks.length,1);
});
test('post-restore retest failure is visible; never forged as success',async()=>{
  const r=await attachPostRestoreRetests({
    restoreResult:committed,authorization,memoId,publicAppUrl,
    retester:async()=>{throw Error('simulated_failure')}
  });
  assert.equal(r.body.status,'restored');
  assert.equal(r.body.postRestoreRetest.status,'failed');
  assert.equal(r.body.postRestoreRetest.checks[0].result,'failed');
});

test('judge restoration without memoId in request still retests restored memo ID', async()=>{
  const restoring={status:200,body:{status:'restored',memoId,ownerMatched:true,contentSha256:hash}};
  const seen=[];
  const r=await attachPostRestoreRetests({
    restoreResult:restoring,authorization,
    memoId:restoring.body.memoId,publicAppUrl,
    retester:async ({memoId:actual})=>{
      seen.push(actual);
      return {status:'passed',checks:[{id:'restored_owner_read',result:'passed',observed:'HTTP_200_HASH_MATCH'}]};
    }
  });
  assert.deepEqual(seen,[memoId]);
  assert.equal(r.body.postRestoreRetest.status,'passed');
});

test('verified identical backup reruns real checks, while preserving no-write status',async()=>{
  let count=0;
  const candidate={status:200,body:{status:'already_matching',memoId,contentSha256:hash}};
  const answer=await attachPostRestoreRetests({
    restoreResult:candidate,authorization,memoId,publicAppUrl,
    retester:async({expectedContentHash})=>{
      count++;
      assert.equal(expectedContentHash,hash);
      return {status:'passed',checks:[{id:'owner_read',result:'passed',observed:'HTTP_200_HASH_MATCH'}]};
    }
  });
  assert.equal(count,1);
  assert.equal(answer.body.status,'already_matching');
  assert.equal(answer.body.postRestoreRetest.status,'passed');
});

test('post-restore Supabase credentials use only apikey for modern server keys',async()=>{
  const {dbHeaders:collectionHeaders}=await import('../api/memos.mjs');
  const {dbHeaders:itemHeaders}=await import('../api/memos/[id].mjs');
  const {dbHeaders:noticeHeaders}=await import('../src/notice-access.mjs');
  for(const makeHeaders of [collectionHeaders,itemHeaders,noticeHeaders]) {
    const modern=['sb','secret',"TEST_ONLY_NOT_REAL"].join('_');
    const headers=makeHeaders(modern);
    assert.equal(headers.apikey,modern);
    assert.equal(Object.hasOwn(headers,'Authorization'),false);
    const legacy='eyJ_TEST_ONLY_NOT_REAL';
    const legacyHeaders=makeHeaders(legacy);
    assert.equal(legacyHeaders.apikey,legacy);
    assert.equal(legacyHeaders.Authorization,'Bearer '+legacy);
  }
});
