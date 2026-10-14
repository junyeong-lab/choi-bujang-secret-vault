// CI sandbox model only: execute the ENTIRE bundle with no subprocess allowance.
// Trace command names and request URLs, never secrets or response bodies.
const child = require('node:child_process');
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const traceFile = process.env.ALEPH_BUNDLE_TRACE_FILE;
if (!traceFile) throw Error('bundle_trace_missing');
const record = entry => fs.appendFileSync(traceFile, JSON.stringify(entry) + '\n', 'utf8');
for (const name of ['execFileSync', 'exec', 'execSync', 'execFile', 'spawn', 'spawnSync', 'fork']) {
  child[name] = (...args) => {
    record({ type: 'subprocess', executable: name,
      firstArgType: typeof args[0] });
    throw Error('bundle_subprocess_forbidden');
  };
}
syncBuiltinESMExports();
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input);
  const method = init.method ?? 'GET';
  record({ type: 'https_request', origin: url.origin, pathname: url.pathname,
    method, optionKeys: Object.keys(init).sort() });
  if (method !== 'GET' || url.origin !== 'https://api.github.com' ||
      !/^\/repos\/junyeong-lab\/choi-bujang-secret-vault\/commits\/[a-f0-9]{40}$/u.test(url.pathname)
      || url.search || url.hash || init.body) throw Error('bundle_request_forbidden');
  return originalFetch(input, init);
};
