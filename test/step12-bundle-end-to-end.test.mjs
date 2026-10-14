import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

test('the ACTUAL scripts/bundle.mjs invocation uses only approved modeled Git reads', () => {
  const temp = mkdtempSync(join(tmpdir(), 'aleph12-bundle-'));
  const trace = join(temp, 'commands.jsonl');
  const notesFile = join(root, 'bundle-notes.json');
  const createdNotes = !existsSync(notesFile);
  try {
    // This file is always outside Git and must not contain identity or secrets.
    if (createdNotes) writeFileSync(notesFile, JSON.stringify({
      explanation: '12단계 독립 격리 모델 실행 검증: 명령 실행·출력 형식을 확인합니다.',
      blockedAt: null
    }) + '\n', 'utf8');
    const run = spawnSync(process.execPath, [
      '--require', join(root, 'test/helpers/bundle-command-guard.cjs'),
      join(root, 'scripts/bundle.mjs')
    ], {
      cwd: root,
      env: { ...process.env, ALEPH_BUNDLE_TRACE_FILE: trace },
      encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024
    });
    const commands = existsSync(trace)
      ? readFileSync(trace, 'utf8').trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse)
      : [];
    // Check actual child-process calls, not just source string patterns.
    assert.deepEqual(commands.map(({ executable, args }) => ({ executable, args })), [
      { executable: 'git', args: ['rev-parse', 'HEAD'] },
      { executable: 'git', args: ['show', 'HEAD'] }
    ], 'actual subprocess command+argument list changed');
    assert.ok(commands.every(x => x.shell === false && x.optionKeys.includes('cwd')),
      'no shell or uncontrolled git working directory is allowed');
    assert.equal(run.status, 0, 'isolated bundle execution failed: ' +
      (run.stderr || run.error?.message || 'exit without error text').slice(0, 350));
    const bundle = JSON.parse(readFileSync(join(root, 'artifacts/submission.json'), 'utf8'));
    const actualHead = git('rev-parse', 'HEAD');
    const expectedPaths = git('diff-tree', '--root', '--no-commit-id', '--name-only',
      '--no-renames', '-r', actualHead).split(/\r?\n/u).filter(Boolean).sort();
    assert.equal(bundle.schema, 'aleph.defense.submission.v2');
    assert.equal(bundle.step, 12);
    assert.equal(bundle.commit, actualHead, 'bundle commit must equal real Git HEAD');
    assert.deepEqual(bundle.changedFiles, expectedPaths,
      'bundle changedFiles must equal Git actual last-commit paths');
    assert.equal(bundle.repoUrl, JSON.parse(readFileSync(join(root, 'aleph.config.json'), 'utf8')).repoUrl);
    assert.equal(bundle.policyRules.length, 3);
    assert.equal(bundle.attackAttempts.length, 18);
    assert.ok(bundle.attackAttempts.every(x => x.observed === 'not_run'));
    assert.ok(!('notes' in bundle));
  } finally {
    if (createdNotes) rmSync(notesFile, { force: true });
    rmSync(temp, { recursive: true, force: true });
  }
});
