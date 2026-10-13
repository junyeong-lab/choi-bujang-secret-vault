import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPolicy, planTestRestore, restoreInIsolatedTestFile } from '../scripts/policy-restore.mjs';
import { loadVerifiedBackup, SOURCE_COMMIT } from '../scripts/policy-diff.mjs';
import { decide } from '../src/decider.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';

const root = process.cwd();
const { copy } = loadVerifiedBackup();
const changed = copy.replace("let decision = 'deny';", "let decision = 'allow';");
test('preflight shows exact single-line change and pinned version', () => {
  const plan = planTestRestore({
    verifiedCopy: copy, currentPolicy: changed,
    expectedCurrentHash: hashPolicy(changed), confirmedVersion: SOURCE_COMMIT
  });
  assert.equal(plan.diff.ranges.length, 1);
  assert.equal(plan.diff.removed, 1);
  assert.equal(plan.diff.added, 1);
  assert.equal(plan.verifiedRestoreHash, hashPolicy(copy));
});
test('incorrect version, stale hash, or missing expected hash fails closed', () => {
  const input = { verifiedCopy: copy, currentPolicy: changed,
    expectedCurrentHash: hashPolicy(changed), confirmedVersion: SOURCE_COMMIT };
  assert.throws(() => planTestRestore({...input,confirmedVersion:'different'}),/VERSION_NOT_CONFIRMED/);
  assert.throws(() => planTestRestore({...input,expectedCurrentHash:hashPolicy(copy)}),/TEST_POLICY_CHANGED/);
  assert.throws(() => planTestRestore({...input,expectedCurrentHash:undefined}),/TEST_POLICY_CHANGED/);
});
test('only an isolated test file is restored; unrelated audit and policy remain unchanged', () => {
  const temp = mkdtempSync(join(tmpdir(), 'aleph10-'));
  try {
    // loadVerifiedBackup uses validated repo Git source; copy only verified policy
    // by supplying the real repo as root isn't compatible with temp. Verify the
    // plan with test-only write, never touching operational policy.
    const testFile = join(temp, 'test-policy.mjs');
    const audit = join(temp, 'audit.jsonl');
    const other = join(temp, 'other-service.mjs');
    writeFileSync(testFile, changed);
    writeFileSync(audit, 'AUDIT_ENTRY_1\n');
    writeFileSync(other, 'other service unchanged\n');
    const p = planTestRestore({
      verifiedCopy: copy, currentPolicy: readFileSync(testFile, 'utf8'),
      expectedCurrentHash: hashPolicy(changed), confirmedVersion: SOURCE_COMMIT
    });
    assert.equal(p.diff.changed, true);
    assert.equal(readFileSync(testFile,'utf8'), changed); // preview is read-only
    writeFileSync(testFile, copy); // isolated temporary fixture represents the confirmed apply step
    assert.equal(hashPolicy(readFileSync(testFile,'utf8')),p.verifiedRestoreHash);
    assert.equal(readFileSync(audit,'utf8'),'AUDIT_ENTRY_1\n');
    assert.equal(readFileSync(other,'utf8'),'other service unchanged\n');
  } finally { rmSync(temp,{recursive:true,force:true}); }
});
test('CLI helper refuses operational src/decider.mjs even with confirmation', () => {
  assert.throws(() => restoreInIsolatedTestFile({
    target:'src/decider.mjs', expectedCurrentHash: hashPolicy(copy),
    confirmedVersion:SOURCE_COMMIT,apply:true
  }), /TEST_TARGET_ONLY/);
});
test('post-restore normal A allows and other-zone B denies in preserved decider', async () => {
  const { normal, suspicious } = fixtureRequests();
  const allowed = await decide({ ...normal, method:'GET', path:'/api/memos/sample-note-1',route:'GET /api/memos/:id' });
  const forbidden = await decide({ ...normal, method:'GET',path:'/api/memos',route:'GET /api/memos' });
  const unregistered = await decide({ ...normal, deviceRegistered:false });
  assert.equal(allowed.decision,'allow');
  assert.equal(forbidden.decision,'deny');
  assert.equal(unregistered.decision,'deny');
  assert.equal((await decide(suspicious)).decision,'step_up');
});

test('real isolated helper dry-run and apply restore exact test file only', () => {
  const id = 'test/fixtures/step10-isolated-' + process.pid + '-' + Math.floor(Math.random()*1000000) + '.mjs';
  const path = join(root, id);
  const originalPolicy = readFileSync(join(root,'src/decider.mjs'), 'utf8');
  const auditSentinel = readFileSync(join(root,'test/fixtures/step10-modified-policy.txt'), 'utf8');
  try {
    writeFileSync(path, changed, {flag:'wx',mode:0o600});
    const preflight = restoreInIsolatedTestFile({
      root, target:id, confirmedVersion:SOURCE_COMMIT,
      expectedCurrentHash:hashPolicy(changed), apply:false
    });
    assert.equal(preflight.applied,false);
    assert.equal(readFileSync(path,'utf8'),changed);
    const applied = restoreInIsolatedTestFile({
      root, target:id, confirmedVersion:SOURCE_COMMIT,
      expectedCurrentHash:hashPolicy(changed), apply:true
    });
    assert.equal(applied.applied,true);
    assert.equal(readFileSync(path,'utf8'),copy);
    assert.equal(readFileSync(join(root,'src/decider.mjs'),'utf8'),originalPolicy);
    assert.equal(readFileSync(join(root,'test/fixtures/step10-modified-policy.txt'),'utf8'),auditSentinel);
    assert.throws(()=>restoreInIsolatedTestFile({
      root,target:id,confirmedVersion:SOURCE_COMMIT,
      expectedCurrentHash:hashPolicy(changed),apply:true
    }),/TEST_POLICY_CHANGED/);
  } finally {
    rmSync(path,{force:true});
  }
});
