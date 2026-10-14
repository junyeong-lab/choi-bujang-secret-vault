import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {verifiedEnvMemo,restoreFromEnv} from '../src/step10-env-backup.mjs';
import {runStep10Restore,emptyOnly} from '../api/restore/notes/[id].mjs';
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const id='22222222-2222-4222-8222-222222222222';
const idA='11111111-1111-4111-8111-111111111111';
const original={id,ownerId:B,title:'Original B',content:'PRIVATE_TEST_ONLY',
  contentSha256:sha('Original B'+'\u0000'+'PRIVATE_TEST_ONLY')};
const raw=JSON.stringify({memo:original});
const signature=sha(raw);
function world({auditFails=false,existing=true}={}){
  const rows=[{id:idA,owner_id:A,title:'A',content:'KEEP_A'},
    ...(existing?[{id,owner_id:B,title:'Damaged',content:'ATTACKED'}]:[])];
  const audits=[{event_id:1,outcome:'restored',memo_id:'OLD_AUDIT',owner_id:A}];
  const calls=[];
  const transport=async(url,init)=>{
    const u=new URL(url), table=u.pathname.split('/').pop();
    const method=init.method;
    calls.push({table,method,query:u.searchParams.toString()});
    const reply=(status,body)=>new Response(JSON.stringify(body),{status});
    if(table==='vault_memos'){
      const find=()=>rows.filter(r=>r.id===u.searchParams.get('id')?.replace('eq.','') &&
        (!u.searchParams.has('owner_id')||r.owner_id===u.searchParams.get('owner_id')?.replace('eq.','')));
      if(method==='GET')return reply(200,find().map(x=>({...x})));
      if(method==='PATCH'){
        const dest=find();if(dest.length!==1)return reply(404,{});
        Object.assign(dest[0],JSON.parse(init.body));return reply(200,dest.map(x=>({...x})));
      }
      if(method==='POST'){
        const data=JSON.parse(init.body);
        if(rows.some(x=>x.id===data.id))return reply(409,{});
        rows.push(data);return reply(201,[{...data}]);
      }
    }
    if(table==='step10_restore_audit'&&method==='POST'){
      if(auditFails)return reply(503,{});
      const audit=JSON.parse(init.body);
      audits.push({...audit,event_id:audits.length+1});
      return reply(201,[{...audit}]);
    }
    return reply(404,{});
  };
  return {rows,audits,calls,transport};
}
const params=(w,extra={})=>({
  raw,integrityHash:signature,id,ownerId:B,
  secret:'sb_secret_TEST_ONLY',supabaseOrigin:'https://example.supabase.co',
  transport:w.transport,...extra
});
test('only an empty request body is accepted, selectors never gain authority',()=>{
  for(const x of [undefined,null,'',{},'{}'])assert.equal(emptyOnly(x),true);
  for(const x of [{id}, {ownerId:B}, {role:'judge'}, {content:'test'}, 'invalid',[],[{}]])assert.equal(emptyOnly(x),false);
});
test('the raw private JSON SHA-256 and claimed note body SHA-256 are checked',()=>{
  const ok=verifiedEnvMemo({raw,integrityHash:signature,id,ownerId:B});
  assert.equal(ok.status,200);
  assert.equal(ok.memo.contentSha256,sha(original.content));
  assert.equal(ok.memo.hashScope,'title_body');
  assert.equal(verifiedEnvMemo({raw,integrityHash:'a'.repeat(64),id,ownerId:B}).status,409);
  assert.equal(verifiedEnvMemo({raw,integrityHash:signature,id,ownerId:A}).status,403);
  assert.equal(verifiedEnvMemo({raw,integrityHash:signature,id:idA,ownerId:B}).status,404);
  const invalid=JSON.stringify({memo:{...original,contentSha256:'0'.repeat(64)}});
  assert.equal(verifiedEnvMemo({raw:invalid,integrityHash:sha(invalid),id,ownerId:B}).status,409);
  assert.equal(verifiedEnvMemo({raw:'not-json',integrityHash:sha('not-json'),id,ownerId:B}).status,409);
});
test('verified B alone is restored; other notes, old audits, and all rules are untouched',async()=>{
  const w=world();
  const others=JSON.stringify(w.rows.filter(x=>x.id!==id));
  const oldAudit=JSON.stringify(w.audits[0]);
  const answer=await restoreFromEnv(params(w));
  assert.equal(answer.status,200);
  assert.equal(answer.body.auditRecorded,true);
  assert.equal(answer.body.ownerVerified,true);
  assert.equal(answer.body.contentSha256,sha(original.content));
  assert.equal(JSON.stringify(w.rows.filter(x=>x.id!==id)),others);
  assert.equal(JSON.stringify(w.audits[0]),oldAudit);
  assert.deepEqual(w.audits.slice(1).map(x=>x.outcome),['started','restored']);
  assert.equal(w.rows.find(x=>x.id===id).content,original.content);
  assert.ok(w.calls.every(x=>x.method!=='DELETE'));
  assert.deepEqual(w.calls.filter(x=>['PATCH','POST'].includes(x.method)).map(x=>x.table),
    ['step10_restore_audit','vault_memos','step10_restore_audit']);
  assert.equal(JSON.stringify(answer).includes(original.content),false);
});
test('deleted note is recreated with the exact owner and ID',async()=>{
  const w=world({existing:false});
  const answer=await restoreFromEnv(params(w));
  assert.equal(answer.status,200);
  assert.equal(answer.body.created,true);
  assert.equal(w.rows.find(x=>x.id===id).owner_id,B);
  assert.equal(w.audits.length,3);
});
test('failed audit is never reported as a successful restore',async()=>{
  const w=world({auditFails:true});
  const answer=await restoreFromEnv(params(w));
  assert.equal(answer.status,503);
  assert.equal(answer.body.error,'audit_unavailable');
  assert.equal(w.audits.length,1);
});
test('mismatched backup, unauthorized owner and unexpected body never write',async()=>{
  const w=world();
  const a=await runStep10Restore({
    id,identity:{kind:'judge',identity:'b',userId:B},
    authorization:'Bearer TEST_ONLY',body:{ownerId:B},backupJson:raw,
    backupSha256:signature,secret:'sb_secret_TEST_ONLY',
    supabaseOrigin:'https://example.supabase.co',transport:w.transport
  });
  assert.equal(a.status,400);
  const noCopy=await restoreFromEnv(params(w,{integrityHash:'0'.repeat(64)}));
  assert.equal(noCopy.status,409);
  assert.equal(w.calls.length,0);
});
test('after committed restore, actual retester output is returned in both response schemas',async()=>{
  const w=world();
  let checks=0;
  const out=await runStep10Restore({
    id,identity:{kind:'judge',identity:'b',userId:B},
    authorization:'Bearer TEST_ONLY',body:{},backupJson:raw,
    backupSha256:signature,secret:'sb_secret_TEST_ONLY',
    supabaseOrigin:'https://example.supabase.co',transport:w.transport,
    retester:async args=>{
      checks++;
      assert.equal(args.memoId,id);
      assert.equal(args.expectedContentHash,sha(original.content));
      return {status:'passed',executedAt:'2026-10-14T00:00:00Z',
        checks:[{id:'owner_read',result:'passed',observed:'HTTP_200_HASH_MATCH'},
          {id:'other_owner_denied',result:'passed',observed:'HTTP_404'}]};
    }
  });
  assert.equal(out.status,200);
  assert.equal(checks,1);
  assert.equal(out.body.postRestoreRetest.status,'passed');
  assert.equal(out.body.restore.retests.status,'passed');
  assert.equal(out.body.restore.retests.checks.length,2);
  assert.equal(JSON.stringify(out.body).includes(original.content),false);
});
test('backup environment missing does not fabricate success or audit',async()=>{
  const w=world();
  const a=await runStep10Restore({id,identity:{kind:'student',userId:B},
    authorization:'Bearer TEST_ONLY',body:{},backupJson:undefined,backupSha256:undefined,
    transport:w.transport});
  assert.equal(a.status,503);
  assert.equal(w.audits.length,1);
  assert.equal(w.calls.length,0);
});
