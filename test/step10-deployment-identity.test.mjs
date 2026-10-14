import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deploymentIdentity } from '../scripts/deployment-identity.mjs';

const env = {
  VERCEL_GIT_PROVIDER:'github',
  VERCEL_GIT_REPO_OWNER:'junyeong-lab',
  VERCEL_GIT_REPO_SLUG:'choi-bujang-secret-vault',
  VERCEL_GIT_COMMIT_SHA:'a'.repeat(40),
  VERCEL_URL:'choi-bujang-secret-vault-build-123.vercel.app',
  VERCEL_ENV:'production',
};
const config = {
  step:10,
  judgeIssuer:'https://aleph-judge-production.up.railway.app/defense/judge',
  sampleMarker:'SAMPLE_NOTE_1',
  publicAppUrl:'https://choi-bujang-secret-vault-pi.vercel.app',
  identityProvider:{issuer:'https://example.supabase.co/auth/v1',audience:'authenticated',jwksUrl:'https://example.supabase.co/auth/v1/.well-known/jwks.json'},
  allowedRoutes:['GET /api/memos', 'POST /api/restore/memo','POST /api/restore/notes/:id'],
  originalApiUrl:'https://example.supabase.co/rest/v1/vault_memos',
  database:{schema:'aleph.defense.database.v1',url:'https://example.supabase.co',publishableKey:'sb_publishable_example',table:'vault_memos'},
  restoreRoute:'POST /api/restore/notes/:id',
};

test('step10 publishes the registered restore route and the canonical production URL',()=>{
  const result=deploymentIdentity(env,config);
  assert.equal(result.restoreRoute, 'POST /api/restore/notes/:id');
  assert.equal(result.publicAppUrl, config.publicAppUrl);
  assert.deepEqual(result.identityProvider,config.identityProvider);
  assert.deepEqual(result.allowedRoutes,config.allowedRoutes);
  assert.equal(result.originalApiUrl,config.originalApiUrl);
  assert.deepEqual(result.database,config.database);
  assert.equal(result.repoUrl,'https://github.com/junyeong-lab/choi-bujang-secret-vault');
});

test('preview announces the specific deployment host instead of the production alias',()=>{
  const result=deploymentIdentity({...env,VERCEL_ENV:'preview'},config);
  assert.equal(result.publicAppUrl,'https://choi-bujang-secret-vault-build-123.vercel.app');
});

test('earlier steps preserve the original deployment identity contract',()=>{
  const old=deploymentIdentity({...env,VERCEL_ENV:'production'},{...config,step:2});
  assert.equal(old.restoreRoute,undefined);
  assert.equal(old.identityProvider,undefined);
  assert.equal(old.database,undefined);
  assert.equal(old.publicAppUrl,'https://choi-bujang-secret-vault-build-123.vercel.app');
});

test('invalid step10 production URL fails closed',()=>{
  for(const publicAppUrl of ['http://bad.vercel.app','https://bad.example.com','https://bad.vercel.app/another','https://bad.vercel.app?x=1']) {
    assert.throws(()=>deploymentIdentity(env,{...config,publicAppUrl}));
  }
});
