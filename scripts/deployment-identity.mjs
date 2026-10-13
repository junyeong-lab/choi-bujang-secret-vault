const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;
const REPO = /^[A-Za-z0-9._-]{1,100}$/u;
const SHA = /^[a-f0-9]{40}$/iu;
const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/iu;

export function deploymentIdentity(env, config) {
  const owner = env.VERCEL_GIT_REPO_OWNER;
  const repo = env.VERCEL_GIT_REPO_SLUG;
  const commit = env.VERCEL_GIT_COMMIT_SHA;
  // A production deployment must advertise the public application URL used by
  // the verified judge JWT audience, not the ephemeral deployment hostname.
  let host = env.VERCEL_URL;
  if (config?.step >= 10 && env.VERCEL_ENV === 'production') {
    let canonical;
    try { canonical = new URL(config.publicAppUrl); }
    catch { throw new Error('10단계 공개 배포 주소가 올바르지 않습니다.'); }
    if (canonical.protocol !== 'https:' || canonical.username || canonical.password ||
        canonical.port || canonical.pathname !== '/' || canonical.search || canonical.hash ||
        !HOST.test(canonical.hostname)) {
      throw new Error('10단계 공개 배포 주소가 올바르지 않습니다.');
    }
    host = canonical.hostname;
  }
  if (env.VERCEL_GIT_PROVIDER !== 'github' || !OWNER.test(owner || '')
      || !REPO.test(repo || '') || repo === '.' || repo === '..'
      || repo.toLowerCase().endsWith('.git') || !SHA.test(commit || '')
      || !HOST.test(host || '') || (!Number.isInteger(config?.step) || config.step < 1 || config.step > 12)
      || typeof config.judgeIssuer !== 'string'
      || !/^https:\/\/[a-z0-9-]+\.up\.railway\.app\/defense\/judge$/iu.test(config.judgeIssuer)
      || typeof config.sampleMarker !== 'string'
      || !/^[A-Z0-9_]{1,80}$/u.test(config.sampleMarker)) {
    throw new Error('배포 식별 정보를 확인할 수 없습니다. Vercel 시스템 환경변수와 단계 설정을 확인하세요.');
  }
  const identity = {
    schema: 'aleph.defense.deployment.v1',
    step: config.step,
    repoUrl: `https://github.com/${owner.toLowerCase()}/${repo.toLowerCase()}`,
    commit: commit.toLowerCase(),
    publicAppUrl: `https://${host.toLowerCase()}`,
    judgeIssuer: config.judgeIssuer,
    sampleMarker: config.sampleMarker,
  };
  if (config.step >= 3) {
    identity.identityProvider = config.identityProvider ?? null;
    identity.allowedRoutes = config.allowedRoutes ?? [];
  }
  if (config.step >= 5) {
    identity.originalApiUrl = config.originalApiUrl ?? null;
    // Public database discovery metadata lets the judge find the submitted
    // project's memo table. It contains a publishable key, never a secret key.
    identity.database = config.database ?? null;
  }
  // Publish the restoreRoute to public /aleph.json for the step-10 judge intake.
  if (config.step >= 10) identity.restoreRoute = config.restoreRoute ?? null;
  return identity;
}
