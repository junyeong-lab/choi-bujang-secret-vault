// 10단계 제작 1: 안전 정책 사본과 시험용 정책의 읽기 전용 차이 확인.
// 실제 운영 정책/DB/감사 기록에 쓰기 작업을 하지 않습니다.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE_COMMIT = '0a56698765f6fb478c99957ef79ab47256c70a65';
export const SOURCE_BLOB = '55192826188e2842cf8b025d9a935c278f067909';
const SOURCE_FILE = 'src/decider.mjs';
const SAFE_FILE = 'backup/step10/safe-decider.mjs';
const MANIFEST_FILE = 'backup/step10/manifest.json';
const MAX_BYTES = 80000;
const MAX_LINES = 1200;

function blobSha1(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
}
function requiredText(root, file, max = MAX_BYTES) {
  let bytes;
  try { bytes = readFileSync(resolve(root, file)); }
  catch { throw new Error('BACKUP_OR_TEST_MISSING: 필수 파일이 없습니다.'); }
  if (bytes.length > max) throw new Error('INPUT_TOO_LARGE');
  const text = bytes.toString('utf8');
  if (text.includes('\ufffd')) throw new Error('INVALID_UTF8');
  return text;
}
export function verifyBackup(copy, source, manifest) {
  if (!manifest || typeof manifest !== 'object' ||
      manifest.schema !== 'aleph.step10.safe-policy.v1' ||
      manifest.sourceCommit !== SOURCE_COMMIT ||
      manifest.sourcePath !== SOURCE_FILE ||
      manifest.safeCopyPath !== SAFE_FILE ||
      manifest.sourceGitBlobSha1 !== SOURCE_BLOB ||
      typeof copy !== 'string' || typeof source !== 'string' ||
      copy !== source || blobSha1(copy) !== SOURCE_BLOB || blobSha1(source) !== SOURCE_BLOB) {
    throw new Error('BACKUP_INVALID: 사본과 9단계 원본의 커밋·내용 지문 불일치');
  }
  return { sourceCommit: SOURCE_COMMIT, sourceBlob: SOURCE_BLOB };
}
export function loadVerifiedBackup(root = ROOT) {
  const copy = requiredText(root, SAFE_FILE);
  let manifest;
  try { manifest = JSON.parse(requiredText(root, MANIFEST_FILE, 5000)); }
  catch { throw new Error('BACKUP_INVALID: 검증 목록이 없거나 올바르지 않습니다.'); }
  let source;
  try {
    source = execFileSync('git', ['show', SOURCE_COMMIT + ':' + SOURCE_FILE], {
      cwd: root, encoding: 'utf8', timeout: 5000, maxBuffer: MAX_BYTES,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
    });
  } catch { throw new Error('BACKUP_INVALID: 검증된 Git 원본을 찾을 수 없습니다.'); }
  return { copy, ...verifyBackup(copy, source, manifest) };
}
function toLines(content) {
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_BYTES) {
    throw new Error('INPUT_TOO_LARGE');
  }
  const lines = content.replace(/\n$/, '').split('\n');
  if (lines.length > MAX_LINES) throw new Error('INPUT_TOO_LARGE');
  return lines;
}
// LCS로 추가/삭제된 줄의 위치와 개수만 반환하고 실제 정책 원문은 유출하지 않습니다.
export function comparePolicies(safe, test) {
  const before = toLines(safe), after = toLines(test);
  const n = before.length, m = after.length, stride = m + 1;
  const dp = new Uint16Array((n + 1) * stride);
  const at = (i, j) => dp[i * stride + j];
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * stride + j] = before[i] === after[j] ?
        at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  let i = 0, j = 0, pending = null;
  const ranges = [];
  const flush = () => { if (pending) { ranges.push(pending); pending = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && before[i] === after[j]) { flush(); i++; j++; }
    else if (i < n && (j === m || at(i + 1, j) >= at(i, j + 1))) {
      pending ??= { safeStart: i + 1, testStart: j + 1, removed: 0, added: 0 };
      pending.removed++; i++;
    } else {
      pending ??= { safeStart: i + 1, testStart: j + 1, removed: 0, added: 0 };
      pending.added++; j++;
    }
  }
  flush();
  return { changed: ranges.length > 0, removed: ranges.reduce((a,b) => a + b.removed,0),
    added: ranges.reduce((a,b) => a + b.added,0), ranges };
}
function safeRelativePath(root, file) {
  if (typeof file !== 'string' || !file.trim()) throw new Error('INVALID_TEST_PATH');
  const relativePath = relative(root, resolve(root, file)).split(sep).join('/');
  if (!relativePath || relativePath === '..' || relativePath.startsWith('../') ||
      relativePath.startsWith('backup/step10/')) throw new Error('INVALID_TEST_PATH');
  return relativePath;
}
export function preview(testFile = SOURCE_FILE, root = ROOT) {
  // 반드시 출처를 검증한 다음 시험 파일을 읽습니다.
  const backup = loadVerifiedBackup(root);
  const path = safeRelativePath(root, testFile);
  const candidate = requiredText(root, path);
  return { sourceCommit: backup.sourceCommit, sourceBlob: backup.sourceBlob,
    testFile: path, diff: comparePolicies(backup.copy, candidate) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2 &&
        !(process.argv.length === 4 && process.argv[2] === '--test-policy')) {
      throw new Error('USAGE: npm run policy:diff -- [--test-policy 상대경로]');
    }
    const result = preview(process.argv[3] ?? SOURCE_FILE);
    console.log('안전 사본 검증: 통과');
    console.log('복원 기준: ' + result.sourceCommit);
    console.log('Git 원본 지문: ' + result.sourceBlob);
    console.log('비교 대상: ' + result.testFile);
    console.log('변경 범위: ' + result.diff.ranges.length + '구간, 삭제 ' +
      result.diff.removed + '줄, 추가 ' + result.diff.added + '줄');
    for (const [index, r] of result.diff.ranges.entries()) {
      console.log('구간 ' + (index + 1) + ': 안전 정책 ' + r.safeStart +
        '번 줄부터 ' + r.removed + '줄 / 시험 정책 ' +
        r.testStart + '번 줄부터 ' + r.added + '줄');
    }
    console.log('실제 정책·데이터 변경: 없음');
  } catch (err) {
    console.error('정책 비교 중단: ' + err.message);
    process.exitCode = 1;
  }
}
