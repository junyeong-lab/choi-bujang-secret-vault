// Stage 10 compatibility endpoint.
// Both public paths share the same verified login, single-owner restore,
// backup integrity checks, and real post-restore retests.
// No alternate authorization or data-copying path is introduced.
export { default } from './restore/memo.mjs';
