// 10단계 제작 2: 검증된 9단계 사본으로 *시험 정책 파일 하나만* 복원합니다.
// 운영 src/decider.mjs, 타 서비스 규칙, 감사 이력은 절대 수정하지 않습니다.
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadVerifiedBackup, comparePolicies, SOURCE_COMMIT } from './policy-diff.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const hashPolicy = source => createHash('sha256').update(source, 'utf8').digest('hex');

export function planTestRestore({verifiedCopy, currentPolicy, expectedCurrentHash, confirmedVersion}) {
  if (confirmedVersion !== SOURCE_COMMIT) throw new Error('VERSION_NOT_CONFIRMED');
  if (typeof verifiedCopy !== 'string' || typeof currentPolicy !== 'string' ||
      typeof expectedCurrentHash !== 'string' || !/^[0-9a-f]{64}$/.test(expectedCurrentHash) ||
      hashPolicy(currentPolicy) !== expectedCurrentHash) throw new Error('TEST_POLICY_CHANGED');
  return {
    policyVersion: SOURCE_COMMIT,
    expectedCurrentHash,
    verifiedRestoreHash: hashPolicy(verifiedCopy),
    diff: comparePolicies(verifiedCopy, currentPolicy)
  };
}

export function restoreInIsolatedTestFile({target, root = ROOT, confirmedVersion, expectedCurrentHash, apply = false}) {
  // First validate the pinned Git object, manifest and safe copy (fail-closed).
  const safe = loadVerifiedBackup(root);
  const filename = resolve(root, target);
  const relativePath = relative(root, filename).split(sep).join('/');
  if (!relativePath.startsWith('test/fixtures/') || relativePath.includes('/../') ||
      !relativePath.endsWith('.mjs')) throw new Error('TEST_TARGET_ONLY');
  if (lstatSync(filename).isSymbolicLink() || !lstatSync(filename).isFile()) throw new Error('TEST_TARGET_ONLY');
  const currentPolicy = readFileSync(filename, 'utf8');
  const plan = planTestRestore({
    verifiedCopy: safe.copy, currentPolicy, expectedCurrentHash, confirmedVersion
  });
  if (!apply || !plan.diff.changed) return { ...plan, applied: false };
  // Recheck before replace, then atomically rename only this selected test file.
  if (hashPolicy(readFileSync(filename,'utf8')) !== expectedCurrentHash) throw new Error('TEST_POLICY_CHANGED');
  const temporary = filename + '.step10-' + randomUUID();
  try {
    writeFileSync(temporary, safe.copy, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, filename);
  } finally {
    try { unlinkSync(temporary); } catch {}
  }
  if (hashPolicy(readFileSync(filename, 'utf8')) !== plan.verifiedRestoreHash) {
    throw new Error('TEST_RESTORE_VERIFY_FAILED');
  }
  return { ...plan, applied: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    // Deliberately require version and current-file hash for every call.
    // A dry run never writes. --apply must be an explicit final argument.
    const args = process.argv.slice(2);
    if (args.length < 6 || args.length > 7 ||
        args[0] !== '--target' || args[2] !== '--version' || args[4] !== '--expected-sha256' ||
        (args.length === 7 && args[6] !== '--apply')) {
      throw new Error('USAGE: --target test/fixtures/file.mjs --version COMMIT --expected-sha256 SHA [--apply]');
    }
    const result = restoreInIsolatedTestFile({
      target: args[1], confirmedVersion: args[3], expectedCurrentHash: args[5],
      apply: args.length === 7
    });
    console.log('시험 정책 복원 기준: ' + result.policyVersion);
    console.log('변경 구간: ' + result.diff.ranges.length + ', 제거 ' +
      result.diff.removed + '줄, 추가 ' + result.diff.added + '줄');
    console.log(result.applied ? '시험 정책 복원 및 지문 재검증: 완료' :
      '읽기 전용 사전 검토 완료 (변경 없음)');
  } catch (e) {
    console.error('정책 복원 중단: ' + e.message);
    process.exitCode = 1;
  }
}
