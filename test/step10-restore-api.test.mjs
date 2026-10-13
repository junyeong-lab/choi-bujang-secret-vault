import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateRestorePayload,runRestoreForVerifiedUser,restoreJudgeOwnedMemo,judgeRestoreDiagnostic,sessionAuth } from '../api/restore/memo.mjs';
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

test('owner can request preview by memo ID, receiving hashes for explicit follow-up', async () => {
  const r = await runRestoreForVerifiedUser({
    ...config,payload:{memoId},
    transport:async(_url, init) => {
      const b=JSON.parse(init.body);
      assert.equal(b.p_snapshot_hash,null);
      assert.equal(b.p_expected_current_hash,null);
      assert.equal(b.p_apply,false);
      return {ok:true,json:async()=>({status:'preview',memoId,ownerMatched:true,
        currentSha256:other,backupSha256:hash,wouldChange:true})};
    }
  });
  assert.equal(r.status,200);
  assert.equal(r.body.backupSha256,hash);
  assert.equal(r.body.currentSha256,other);
  assert.equal(validateRestorePayload({memoId,apply:true,confirm:'RESTORE_ONE_MEMO'}),null);
});
test('preview forged hashes are rejected',async()=>{
  const r=await runRestoreForVerifiedUser({...config,payload:base,
    transport:async()=>({ok:true,json:async()=>({status:'preview',memoId,
      ownerMatched:true,currentSha256:other,backupSha256:'c'.repeat(64),wouldChange:true})})});
  assert.equal(r.status,502);
});

test('judge B preview THEN single optimistic-locked restore (no supplied hashes)',async()=>{
  const calls=[];
  const data={kind:'judge',identity:'b',userId:owner};
  const r=await restoreJudgeOwnedMemo({
    ...config,identity:data,payload:{memoId},
    transport:async(_url,init)=>{
      const p=JSON.parse(init.body); calls.push(p);
      if(!p.p_apply)return {ok:true,json:async()=>({status:'preview',
        memoId,ownerMatched:true,backupSha256:hash,currentSha256:other,wouldChange:true})};
      return {ok:true,json:async()=>({status:'restored',memoId,
        ownerMatched:true,contentSha256:hash})};
    }
  });
  assert.equal(r.status,200);
  assert.equal(r.body.status,'restored');
  assert.equal(calls.length,2);
  assert.equal(calls[0].p_apply,false);
  assert.equal(calls[1].p_apply,true);
  assert.equal(calls[1].p_owner_id,owner);
  assert.equal(calls[1].p_snapshot_hash,hash);
  assert.equal(calls[1].p_expected_current_hash,other);
});
test('judge B can resolve exactly one own snapshot without an ID',async()=>{
  const data={kind:'judge',identity:'b',userId:owner};
  const paths=[];
  const r=await restoreJudgeOwnedMemo({
    ...config,identity:data,payload:{},
    transport:async(url,init)=>{
      paths.push(new URL(url).pathname);
      if(new URL(url).pathname.endsWith('/step10_memo_snapshots')){
        assert.equal(new URL(url).searchParams.get('owner_id'),'eq.'+owner);
        return {ok:true,json:async()=>[{memo_id:memoId}]};
      }
      const p=JSON.parse(init.body);
      return {ok:true,json:async()=>p.p_apply ?
        {status:'restored',memoId,ownerMatched:true,contentSha256:hash}:
        {status:'preview',memoId,ownerMatched:true,
          backupSha256:hash,currentSha256:other,wouldChange:true}};
    }
  });
  assert.equal(r.body.status,'restored');
  assert.equal(paths.length,3);
});
test('judge path fails closed: wrong identity, extra fields and multiple targets',async()=>{
  const data={kind:'judge',identity:'b',userId:owner};
  const fail=async identityAndPayload=>restoreJudgeOwnedMemo({
    ...config, ...identityAndPayload,
    transport:async()=>{throw Error('must_not_reach_database');}
  });
  assert.equal((await fail({identity:{...data,identity:'a'},payload:{memoId}})).status,403);
  assert.equal((await fail({identity:{kind:'student',userId:owner},payload:{memoId}})).status,403);
  assert.equal((await fail({identity:data,payload:{memoId,owner_id:owner}})).status,400);
  assert.equal((await fail({identity:data,payload:{id:memoId,memoId}})).status,400);
});
test('judge preflight refuses absent backup or no actual changes without writing',async()=>{
  const identity={kind:'judge',identity:'b',userId:owner};
  let writes=0;
  const missing=await restoreJudgeOwnedMemo({...config,identity,payload:{},
    transport:async()=>({ok:true,json:async()=>[]})});
  assert.equal(missing.status,404);
  const same=await restoreJudgeOwnedMemo({...config,identity,payload:{memoId},
    transport:async(_url,init)=>{
      const p=JSON.parse(init.body);
      if(p.p_apply)writes++;
      return {ok:true,json:async()=>({status:'preview',memoId,
        ownerMatched:true,backupSha256:hash,currentSha256:hash,wouldChange:false})};
    }
  });
  assert.equal(same.body.status,'already_matching');
  assert.equal(writes,0);
});

test('diagnostics distinguish backup, concurrency, and unexecuted retest without sensitive data',()=>{
  const lookup=judgeRestoreDiagnostic({status:404,body:{error:'backup_not_found'}});
  assert.deepEqual(lookup,{stage:'backup_lookup',retestExecuted:false,retestStatus:'not_run'});
  const changed=judgeRestoreDiagnostic({status:409,body:{error:'current_changed'}});
  assert.equal(changed.stage,'concurrent_change');
  const failed=judgeRestoreDiagnostic({status:200,body:{status:'restored',
    postRestoreRetest:{status:'failed',checks:[{id:'retest_execution',result:'failed'}]}}});
  assert.equal(failed.stage,'post_restore_retest');
  assert.equal(failed.retestExecuted,true);
  assert.equal(failed.retestStatus,'failed');
  const absent=judgeRestoreDiagnostic({status:200,body:{status:'restored'}});
  assert.equal(absent.stage,'post_restore_retest_not_executed');
  assert.equal(absent.retestExecuted,false);
  assert.equal(JSON.stringify([lookup,changed,failed,absent]).includes('owner_id'),false);
});

test('explicit judge Authorization takes priority over an unrelated session cookie',()=>{
  const req={headers:{authorization:'Bearer VERIFIED_JUDGE_HEADER',
    cookie:'vault_session=UNRELATED_BROWSER_COOKIE'}};
  assert.deepEqual(sessionAuth(req),{
    authorization:'Bearer VERIFIED_JUDGE_HEADER',fromCookie:false
  });
  assert.deepEqual(sessionAuth({headers:{cookie:'vault_session=COOKIE_ONLY'}}),{
    authorization:'Bearer COOKIE_ONLY',fromCookie:true
  });
  assert.deepEqual(sessionAuth({headers:{}}),{
    authorization:undefined,fromCookie:false
  });
});
