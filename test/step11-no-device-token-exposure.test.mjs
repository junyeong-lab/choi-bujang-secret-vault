import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
test('public PWA has no key generator, credentials API, browser storage access or cookie reads',()=>{
 const html=read('public/index.html'),sw=read('public/sw.js'),offline=read('public/offline.html');
 for(const s of [html,sw,offline]){
   assert.doesNotMatch(s,/navigator\.credentials|crypto\.subtle|localStorage|sessionStorage|indexedDB|document\.cookie|attestationObject|clientDataJSON|authenticatorData/u);
   assert.doesNotMatch(s,/-----BEGIN [A-Z ]*PRIVATE KEY-----/u);
 }
 assert.match(html,/fetch\('\/api\/device'/u);
 assert.match(html,/서버 승인 전에는 보호 자료를 열 수 없습니다/u);
});
test('server issues only an HttpOnly opaque handle, and persists SHA fingerprint',()=>{
 const gate=read('src/device-approval.mjs');
 const api=read('api/device.mjs');
 assert.match(gate,/randomBytes\(32\)\.toString\('base64url'\)/u);
 assert.match(gate,/handle_sha256:digest\(handle\)/u);
 assert.match(gate,/HttpOnly; Secure; SameSite=Strict/u);
 assert.match(gate,/status:'pending'/u);
 assert.match(gate,/status==='approved'/u);
 assert.doesNotMatch(api,/registerFinish|verifyFinish|attestationObject|publicKeyJwk/u);
 assert.doesNotMatch(gate,/localStorage|sessionStorage|indexedDB/u);
});
test('other protected routes remain guarded by server-side approved device check',()=>{
 for(const path of ['api/memos.mjs','api/memos/[id].mjs','api/notices.mjs','api/notices/[id].mjs']){
   assert.match(read(path),/await requireApprovedDevice/u,path);
 }
});
