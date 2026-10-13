// Stage 10 compatibility entry point. Keep the tested restoration logic in scripts/.
// Its backup integrity gate checks SOURCE_BLOB from policy-diff.mjs, independent of manifest.json.
// No change to operational policy, backups, database, or restoration authority.
export { hashPolicy, planTestRestore, restoreInIsolatedTestFile } from '../scripts/policy-restore.mjs';
