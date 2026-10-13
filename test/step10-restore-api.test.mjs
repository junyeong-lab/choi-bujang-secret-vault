import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateRestorePayload,runRestoreForVerifiedUser } from '../api/restore/memo.mjs';
const memoId='sample-note-5';
const hash='a'.repeat(64),other='b'.repeat(64);
const owner='00000000-0000-4000-8000-000000000001';
const base={memoId,snapshotHash:hash,expectedCurrentHash:other};
const config={userId:owner,supabaseOrigin:'https://fijeiiqdyjqmunesjpyk.supabase.co',secret:'TEST_ONLY_NOT_A_REAL_KEY'};
test('accepts preview, rejects role, owner and dangerous selectors',()=>{
  assert.equal(validateRestorePayload(base).apply,false);
  assert.equal(validateRestorePayload({...base,role:'instructor'}),null);
  assert.equal(validateRestorePayload({...base,owner_id:owner}),null);
  assert.equal(validateRestorePayload({...base,memoId:'../other'}),null);
  assert.equal(validateRestorePayload({...base,apply:true}),null);
  assert.equal(validateRestorePayload({...base,apply:true,confirm:'RESTORE_ONE_MEMO'}).apply,true);
});
test('uses ONLY authenticated identity as owner, no content in response',async()=>{
  let request;
  const r=await runRestoreForVerifiedUser({...config,payload:base,transport:async(_url,init)=>{
    request=JSON.parse(init.body);
    return {ok:true,json:async()=>({status:'preview',memoId,ownerMatched:true,
      backupSha256:hash,currentSha256:other,wouldChange:true})};
  }});
  assert.equal(r.status,200);
  assert.equal(r.body.status,'preview');
  assert.deepEqual(Object.keys(request).sort(),['p_apply','p_expected_current_hash','p_id','p_owner_id','p_snapshot_hash']);
  assert.equal(request.p_owner_id,owner);
  assert.equal(request.p_apply,false);
  assert.equal(JSON.stringify(r).includes('content'),false);
});
test('preview is not incorrectly reported as restoration',async()=>{
  const r=await runRestoreForVerifiedUser({...config,payload:{...base,apply:true,confirm:'RESTORE_ONE_MEMO'},
    transport:async()=>({ok:true,json:async()=>({status:'preview',memoId,ownerMatched:true,
    backupSha256:hash,currentSha256:other,wouldChange:true})})});
  assert.equal(r.status,502);
});
test('apply succeeds only after hash/owner/ID are confirmed by database',async()=>{
  const r=await runRestoreForVerifiedUser({...config,payload:{...base,apply:true,confirm:'RESTORE_ONE_MEMO'},
    transport:async()=>({ok:true,json:async()=>({status:'restored',memoId,
      ownerMatched:true,contentSha256:hash})})});
  assert.equal(r.status,200);
  assert.equal(r.body.contentSha256,hash);
});
test('missing backup, modified memo and invalid saved backup are fail-closed',async()=>{
  for (const [status,code] of [['backup_not_found',404],['owner_mismatch',404],
    ['current_changed',409],['backup_invalid',409]]) {
    const r=await runRestoreForVerifiedUser({...config,payload:base,
      transport:async()=>({ok:true,json:async()=>({status})})});
    assert.equal(r.status,code);
  }
});
test('server and network errors remain closed',async()=>{
  const r=await runRestoreForVerifiedUser({...config,payload:base,
    transport:async()=>{throw Error('network failed')}});
  assert.equal(r.status,502);
  assert.equal((await runRestoreForVerifiedUser({...config,userId:'arbitrary',payload:base})).status,401);
});
