import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler, { validateRestorePayload,runRestoreForVerifiedUser,restoreJudgeOwnedMemo,judgeRestoreDiagnostic,sessionAuth,restoreLogRecord } from '../api/restore/memo.mjs';
import { createHash } from 'node:crypto';
import { generateKeyPair,exportJWK,SignJWT } from 'jose';
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

test('restore log projection includes only categorical diagnostics, never private data',()=>{
  const privateValue='PRIVATE_TEST_SENTINEL';
  const record=restoreLogRecord({status:404,body:{error:'backup_not_found',
    memoId:privateValue,owner_id:privateValue,body:privateValue,
    authorization:privateValue,postRestoreRetest:{status:privateValue}}},privateValue);
  assert.deepEqual(record,{event:'step10_restore',httpStatus:404,
    stage:'backup_lookup',retestStatus:'not_run'});
  assert.equal(JSON.stringify(record).includes(privateValue),false);
});

test('full handler logs rejection stages and signed judge restore/retest without changing responses',async(t)=>{
  const oldSecret=process.env.SUPABASE_SECRET_KEY;
  const oldOrigin=process.env.SUPABASE_URL;
  t.after(()=>{
    if(oldSecret===undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY=oldSecret;
    if(oldOrigin===undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL=oldOrigin;
  });
  const records=[];
  t.mock.method(console,'info',value=>records.push(JSON.parse(value)));
  const {privateKey,publicKey}=await generateKeyPair('ES256');
  const jwk={...await exportJWK(publicKey),kid:'isolated-test',alg:'ES256',use:'sig'};
  const token=await new SignJWT({aleph_role:'judge',aleph_identity:'b',
    aleph_run:'00000000-0000-4000-8000-000000000002'})
    .setProtectedHeader({alg:'ES256',kid:'isolated-test'})
    .setIssuer('https://aleph-judge-production.up.railway.app/defense/judge')
    .setAudience('choi-bujang-secret-vault-pi.vercel.app')
    .setSubject(owner).setIssuedAt().setExpirationTime('10m').sign(privateKey);
  const content='ISOLATED_RESTORE_TEST_CONTENT';
  const restoredHash=createHash('sha256').update(content).digest('hex');
  let backupExists=false,committed=false;
  const calls=[];
  t.mock.method(globalThis,'fetch',async(input,init={})=>{
    const url=new URL(input);
    calls.push(url.pathname);
    const json=(body,status=200)=>new Response(JSON.stringify(body),{status,
      headers:{'Content-Type':'application/json'}});
    if(url.href==='https://aleph-judge-production.up.railway.app/defense/judge/.well-known/jwks.json') {
      return json({keys:[jwk]});
    }
    if(url.origin===config.supabaseOrigin) {
      if(url.pathname==='/rest/v1/step10_memo_snapshots') {
        assert.equal(url.searchParams.get('owner_id'),'eq.'+owner);
        return json(backupExists?[{memo_id:memoId}]:[]);
      }
      if(url.pathname==='/rest/v1/rpc/step10_restore_one_memo') {
        const p=JSON.parse(init.body);
        assert.equal(p.p_owner_id,owner);
        assert.equal(p.p_id,memoId);
        if(!p.p_apply) return json({status:'preview',memoId,ownerMatched:true,
          backupSha256:restoredHash,currentSha256:other,wouldChange:true});
        assert.equal(p.p_snapshot_hash,restoredHash);
        assert.equal(p.p_expected_current_hash,other);
        committed=true;
        return json({status:'restored',memoId,ownerMatched:true,contentSha256:restoredHash});
      }
    }
    if(url.origin==='https://choi-bujang-secret-vault-pi.vercel.app') {
      assert.equal(committed,true,'HTTP retests must follow the simulated DB commit');
      if(url.pathname==='/api/memos/'+memoId) return json({id:memoId,body:content});
      if(url.pathname==='/api/memos/sample-note-1') return json({error:'not_found'},404);
      if(url.pathname==='/api/memos') return json({error:'unauthorized'},401);
      if(url.pathname==='/api/notices') return json({error:'instructor_only'},403);
    }
    throw Error('unexpected_test_transport');
  });
  async function invoke(req){
    const response={setHeader(){},status(code){this.code=code;return this;},
      json(body){this.body=body;return this;}};
    const before=records.length;
    await handler({headers:{},...req},response);
    assert.equal(records.length,before+1);
    assert.equal(records.at(-1).httpStatus,response.code);
    return response;
  }
  assert.equal((await invoke({method:'GET'})).code,405);
  assert.equal(records.at(-1).stage,'method');
  delete process.env.SUPABASE_SECRET_KEY;
  assert.equal((await invoke({method:'POST'})).code,503);
  assert.equal(records.at(-1).stage,'configuration');
  process.env.SUPABASE_SECRET_KEY=config.secret;
  process.env.SUPABASE_URL=config.supabaseOrigin;
  assert.equal((await invoke({method:'POST',headers:{cookie:'vault_session=TEST'}})).code,403);
  assert.equal(records.at(-1).stage,'origin_check');
  assert.equal((await invoke({method:'POST',body:{}})).code,401);
  assert.equal(records.at(-1).stage,'authentication');
  assert.equal(calls.length,0,'rejected requests must not reach external services');
  const headers={authorization:'Bearer '+token};
  assert.equal((await invoke({method:'POST',headers,body:'{'})).code,400);
  assert.equal(records.at(-1).stage,'request_body');
  const missing=await invoke({method:'POST',headers,body:{}});
  assert.equal(missing.code,404);
  assert.equal(missing.body.error,'backup_not_found');
  assert.equal(missing.body.restoreDiagnostic.retestExecuted,false);
  assert.equal(records.at(-1).stage,'backup_lookup');
  assert.equal(committed,false);
  backupExists=true;
  const restored=await invoke({method:'POST',headers,body:{}});
  assert.equal(restored.code,200);
  assert.equal(restored.body.status,'restored');
  assert.equal(restored.body.postRestoreRetest.status,'passed');
  assert.equal(restored.body.postRestoreRetest.checks.length,10);
  assert.equal(records.at(-1).stage,'post_restore_retest');
  assert.equal(records.at(-1).retestStatus,'passed');
  const logs=JSON.stringify(records);
  for(const value of [token,owner,content,memoId,config.secret]) {
    assert.equal(logs.includes(value),false);
  }
  t.mock.method(console,'info',()=>{throw Error('logger_unavailable');});
  const unchanged={setHeader(){},status(code){this.code=code;return this;},
    json(body){this.body=body;}};
  await handler({method:'GET',headers:{}},unchanged);
  assert.equal(unchanged.code,405);
  assert.deepEqual(unchanged.body,{error:'method_not_allowed'});
});
