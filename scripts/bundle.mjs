import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
// Read the real checkout HEAD using fs. No child processes in the bundle.
function readCheckoutSha() {
  let gitDir = join(root, '.git');
  if (!existsSync(join(gitDir, 'HEAD'))) {
    const marker = readFileSync(gitDir, 'utf8').trim();
    const match = /^gitdir: (.+)$/u.exec(marker);
    if (!match) throw Error('git_checkout_missing');
    gitDir = resolve(root, match[1]);
  }
  const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim();
  const isSha = value => /^[a-f0-9]{40}$/u.test(value);
  if (isSha(head)) return head;
  const ref = /^ref: (refs\/[A-Za-z0-9._/-]+)$/u.exec(head)?.[1];
  if (!ref || ref.includes('..') || ref.includes('//')) throw Error('invalid_git_ref');
  const refPath = join(gitDir, ref);
  if (existsSync(refPath)) {
    const sha = readFileSync(refPath, 'utf8').trim();
    if (isSha(sha)) return sha;
    throw Error('invalid_git_ref_sha');
  }
  const packed = readFileSync(join(gitDir, 'packed-refs'), 'utf8');
  const record = packed.split(/\r?\n/u).find(line => line.endsWith(' ' + ref));
  const sha = record?.slice(0, 40);
  if (!isSha(sha)) throw Error('missing_git_ref_sha');
  return sha;
}
async function readCommitFiles(repoUrl, commit) {
  const rootUrl = new URL(repoUrl);
  const match = /^\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/u.exec(rootUrl.pathname);
  if (!match || rootUrl.origin !== 'https://github.com') throw Error('invalid_git_origin');
  const endpoint = 'https://api.github.com/repos/' + match[1] + '/' + match[2] + '/commits/' + commit;
  const response = await fetch(endpoint, {
    method: 'GET', redirect: 'error', cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'aleph-bundle-public-commit-read' },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw Error('public_commit_http_' + response.status);
  const data = await response.json();
  if (data?.sha !== commit || !Array.isArray(data.files) ||
      !data.files.length || data.files.length >= 300) throw Error('invalid_commit_files');
  const paths = data.files.map(item => item.filename);
  if (paths.some(p => typeof p !== 'string' || !/^[A-Za-z0-9_./-]+$/u.test(p)
      || p.includes('..') || p.startsWith('/')) || new Set(paths).size !== paths.length)
    throw Error('invalid_commit_path');
  return paths.sort();
}
const fail = (message) => { throw new Error(message); };
const secretPattern = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/-]{16,}|\bsb_secret_[A-Za-z0-9_-]{12,}|\bsk-[A-Za-z0-9_-]{20,}|\beyJ[A-Za-z0-9_-]{12,}\.eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;
const repository = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/([A-Za-z0-9._-]{1,100})\/?$/iu;
const normalizedRepo = value => {
  const match = typeof value === 'string' && value.length <= 250 && repository.exec(value);
  if (!match) fail('GitHub HTTPS 저장소 주소를 origin으로 등록해 주세요.');
  const repo = match[2].toLowerCase().replace(/\.git$/u, '');
  if (repo === '.' || repo === '..' || repo === '.git' || repo.endsWith('.git')) {
    fail('GitHub HTTPS 저장소 주소를 origin으로 등록해 주세요.');
  }
  return `https://github.com/${match[1].toLowerCase()}/${repo}`;
};

try {
  // Source-of-truth commit from the checkout, file list from its public
  // GitHub record. No Git executable is spawned in the isolated bundle.
  const commit = readCheckoutSha();
  const config = JSON.parse(readFileSync(join(root, 'aleph.config.json'), 'utf8'));
  const repoUrl = normalizedRepo(config.repoUrl);
  const changedFiles = await readCommitFiles(repoUrl, commit);
  const notes = JSON.parse(readFileSync(join(root, 'bundle-notes.json'), 'utf8'));
  if (!Number.isInteger(config.step) || config.step < 1 || config.step > 12) fail('aleph.config.json의 step을 확인해 주세요.');
  if (config.step >= 3 && (!config.identityProvider || typeof config.identityProvider !== 'object'
      || ['issuer', 'audience', 'jwksUrl'].some((key) => typeof config.identityProvider[key] !== 'string'
        || !config.identityProvider[key].trim()))) {
    fail('3단계부터 aleph.config.json의 identityProvider에 발급자·대상·공개키 주소가 필요합니다. 3단계 제작 2를 다시 확인해 주세요.');
  }
  if (config.step >= 5 && (typeof config.originalApiUrl !== 'string'
      || !config.originalApiUrl.startsWith('https://'))) {
    fail('5단계부터 aleph.config.json의 originalApiUrl에 원본 자료 API의 HTTPS 주소가 필요합니다. 5단계 제작 2를 다시 확인해 주세요.');
  }
  if (config.step >= 3 && (!Array.isArray(config.allowedRoutes) || !config.allowedRoutes.length)) {
    fail('3단계부터 aleph.config.json의 allowedRoutes에 자료 API 경로가 필요합니다. 3단계 제작 3을 다시 확인해 주세요.');
  }
  const deciderUrl = pathToFileURL(join(root, 'src', 'decider.mjs'));
  const { RULE_IDS } = await import(deciderUrl.href);
  if (!Array.isArray(RULE_IDS)) fail('src/decider.mjs의 RULE_IDS는 규칙 이름 배열이어야 합니다.');
  const policyRules = [...RULE_IDS];
  if (policyRules.length > 80 || policyRules.some(item => typeof item !== 'string'
      || !/^[a-z][a-z0-9_.-]{0,79}$/iu.test(item)) || new Set(policyRules).size !== policyRules.length) {
    fail('src/decider.mjs의 RULE_IDS 이름과 중복을 확인해 주세요.');
  }
  if (typeof notes.explanation !== 'string' || notes.explanation.trim().length < 10) {
    fail('bundle-notes.json의 explanation에 이번 단계에서 한 일을 세 줄로 적어 주세요.');
  }
  const checkerUrl = pathToFileURL(join(root, 'src', 'attack-check.mjs'));
  const { runAttackChecks } = await import(checkerUrl.href);
  if (typeof runAttackChecks !== 'function') fail('src/attack-check.mjs가 runAttackChecks를 내보내야 합니다.');
  const attackAttempts = await runAttackChecks(config);
  if (!Array.isArray(attackAttempts) || !attackAttempts.length || attackAttempts.length > 20) {
    fail('직접 실행한 공격 점검 결과 1~20개가 필요합니다.');
  }
  for (const attempt of attackAttempts) {
    if (!attempt || typeof attempt !== 'object' || Array.isArray(attempt)
        || Object.keys(attempt).sort().join(',') !== 'attackId,expected,observed'
        || typeof attempt.attackId !== 'string' || !/^[a-z0-9][a-z0-9_.-]{0,79}$/iu.test(attempt.attackId)
        || typeof attempt.expected !== 'string' || !attempt.expected.trim() || attempt.expected.length > 300
        || typeof attempt.observed !== 'string' || !attempt.observed.trim() || attempt.observed.length > 300) {
      fail('공격 점검 결과에는 attackId·expected·observed만 넣어 주세요.');
    }
  }
  if (new Set(attackAttempts.map(item => item.attackId)).size !== attackAttempts.length) {
    fail('공격 점검 ID가 중복되었습니다.');
  }
  const bundle = {
    schema: 'aleph.defense.submission.v2', step: config.step, commit, repoUrl,
    changedFiles, policyRules,
    attackAttempts, explanation: notes.explanation.trim(), blockedAt: notes.blockedAt ?? null,
    identityProvider: config.identityProvider ?? null, allowedRoutes: config.allowedRoutes ?? [],
    originalApiUrl: config.originalApiUrl ?? null, restoreRoute: config.restoreRoute ?? null,
  };
  if (secretPattern.test(JSON.stringify(bundle))) fail('제출 묶음에 비밀값 또는 연락처로 보이는 내용이 있습니다.');
  mkdirSync(join(root, 'artifacts'), { recursive: true });
  const output = join(root, 'artifacts', 'submission.json');
  writeFileSync(output, `${JSON.stringify(bundle, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });
  process.stdout.write(`제출 묶음 JSON 생성: ${output}\n단계 ${bundle.step} · 커밋 ${commit.slice(0, 12)} · 바뀐 파일 ${changedFiles.length}개 · 규칙 ${policyRules.length}개 · 직접 점검 ${attackAttempts.length}개\n`);
} catch (error) {
  process.stderr.write(`제출 묶음 생성 중 첫 오류: ${error.message}\n`);
  process.exitCode = 1;
}
