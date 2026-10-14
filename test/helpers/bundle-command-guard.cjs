// Loaded only by the local/CI sandbox-model test, not by npm run bundle.
// Capture actual child_process invocations and reject everything except two
// explicit Git reads. Neither environment variables nor command output are logged.
const child = require('node:child_process');
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');

const safe = new Set([JSON.stringify(['rev-parse', 'HEAD']), JSON.stringify(['show', 'HEAD'])]);
const realExecFileSync = child.execFileSync;
const traceFile = process.env.ALEPH_BUNDLE_TRACE_FILE;
if (!traceFile) throw new Error('bundle_guard_trace_missing');

const record = (entry) => fs.appendFileSync(traceFile, JSON.stringify(entry) + '\n', 'utf8');
const unsupported = name => (...args) => {
  record({ executable: name, argumentTypes: args.map(v => typeof v) });
  throw new Error('bundle_guard_forbidden_subprocess:' + name);
};
child.execFileSync = function(executable, args, options) {
  record({
    executable,
    args: Array.isArray(args) ? args : null,
    optionKeys: options && typeof options === 'object' ? Object.keys(options).sort() : [],
    shell: Boolean(options && options.shell)
  });
  if (executable !== 'git' || !Array.isArray(args) || !safe.has(JSON.stringify(args)) ||
      !options || options.shell || typeof options.cwd !== 'string') {
    throw new Error('bundle_guard_unapproved_git_read');
  }
  return realExecFileSync.apply(this, arguments);
};
for (const name of ['exec', 'execSync', 'execFile', 'spawn', 'spawnSync', 'fork']) {
  child[name] = unsupported(name);
}
syncBuiltinESMExports();
// Entire bundle is prohibited from issuing network calls in stage 12.
globalThis.fetch = async () => { throw new Error('bundle_guard_network_forbidden'); };
