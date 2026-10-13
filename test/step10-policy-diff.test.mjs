import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { comparePolicies, SOURCE_COMMIT, SOURCE_BLOB, verifyBackup, loadVerifiedBackup, preview } from '../scripts/policy-diff.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const copy = readFileSync(resolve(root, 'backup/step10/safe-decider.mjs'), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(root, 'backup/step10/manifest.json'), 'utf8'));
const original = execFileSync('git', ['show', SOURCE_COMMIT + ':src/decider.mjs'], {cwd:root, encoding:'utf8'});
test('approved source commit and safety copy match byte-for-byte', () => {
  const v = verifyBackup(copy, original, manifest);
  assert.deepEqual(v, {sourceCommit:SOURCE_COMMIT,sourceBlob:SOURCE_BLOB});
  assert.equal(loadVerifiedBackup(root).copy,copy);
});
test('unchanged original policy has no differences', () => {
  assert.deepEqual(preview('src/decider.mjs',root).diff.ranges, []);
});
test('test fixture reports change ranges without policy code', () => {
  const report = preview('test/fixtures/step10-modified-policy.txt',root);
  assert.equal(report.diff.changed,true);
  assert.equal(report.diff.removed,1);
  assert.equal(report.diff.added,1);
  assert.equal(report.diff.ranges.length,1);
  assert.equal(JSON.stringify(report).includes("let decision = 'allow'"),false);
});
test('tampered copy is rejected', () => {
  const forged = copy.replace("let decision = 'deny';","let decision = 'allow';");
  assert.throws(()=>verifyBackup(forged,original,manifest),/BACKUP_INVALID/);
});
test('invalid pinned source and hash are rejected', () => {
  assert.throws(()=>verifyBackup(copy,original,{...manifest,sourceCommit:'unknown'}),/BACKUP_INVALID/);
  assert.throws(()=>verifyBackup(copy,original,{...manifest,sourceGitBlobSha1:'0000'}),/BACKUP_INVALID/);
});
test('tampering with safe copy AND manifest together cannot bypass pinned source hash', () => {
  const forgedCopy=copy.replace("let decision = 'deny';","let decision = 'allow';");
  assert.notEqual(forgedCopy,copy);
  const forgedManifest={...manifest,sourceGitBlobSha1:'0000000000000000000000000000000000000000'};
  assert.throws(()=>verifyBackup(forgedCopy,forgedCopy,forgedManifest),/BACKUP_INVALID/);
});
test('missing copy causes fail closed', () => {
  assert.throws(()=>loadVerifiedBackup('/no-such-policy-root'),/BACKUP_OR_TEST_MISSING/);
});
test('outside directory and copy self-comparison paths rejected', () => {
  assert.throws(()=>preview('../outside.txt',root),/INVALID_TEST_PATH/);
  assert.throws(()=>preview('backup/step10/safe-decider.mjs',root),/INVALID_TEST_PATH/);
});
test('insertion is a single range', () => {
  assert.deepEqual(comparePolicies('a\nb\nc\n','a\nNEW\nb\nc\n').ranges,
    [{safeStart:2,testStart:2,removed:0,added:1}]);
});
test('sensitive text never appears in returned change summary', () => {
  const result=comparePolicies('keep\n','PRIVATE_DEMO_CONTENT\n');
  assert.equal(JSON.stringify(result).includes('PRIVATE_DEMO_CONTENT'),false);
});
