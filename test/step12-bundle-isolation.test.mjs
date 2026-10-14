import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runAttackChecks } from '../src/attack-check.mjs';

test('step 12 bundle never performs HTTP probes and reports not_run', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    throw new Error('network_call_not_allowed_in_isolated_bundle');
  };
  try {
    const checks = await runAttackChecks({ step: 12 });
    assert.equal(requests, 0);
    assert.equal(checks.length, 18);
    assert.equal(new Set(checks.map(c => c.attackId)).size, checks.length);
    assert.ok(checks.every(c =>
      Object.keys(c).sort().join(',') === 'attackId,expected,observed' &&
      c.observed === 'not_run'));
    assert.ok(checks.some(c => c.attackId === 'full_41_attack_run'));
    assert.ok(checks.some(c => c.attackId === 'cross_owner_note_access'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('only the isolated bundle helper is changed, previously approved API gate stays intact', () => {
  const script = readFileSync(new URL('../scripts/bundle.mjs', import.meta.url), 'utf8');
  assert.match(script, /runAttackChecks\(config\)/);
  assert.doesNotMatch(script, /git\('status'|git\('config'|git\('remote'/);
  assert.match(script, /writeFileSync\(output/);
});
