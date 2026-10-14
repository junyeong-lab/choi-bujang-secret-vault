import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');

test('pending or revoked or expired devices cannot open protected data',()=>{
 const backend=read('src/device-approval.mjs');
 assert.match(backend,/const verified=status==='approved'/u);
 assert.match(backend,/Number\.isFinite\(approvedAt\)/u);
 assert.match(backend,/approvedAt<=now/u);
 assert.match(backend,/approvedAt>=Date\.parse\(record\.requested_at\)/u);
 assert.match(backend,/expires<=now/u);
 assert.match(backend,/return \{status:'expired',approved:false/u);
 assert.match(backend,/res\.status\(403\)\.json\(\{error:'device_not_approved'\}\)/u);
});
test('client never treats installation/request result as server trust',()=>{
 const client=read('public/index.html');
 assert.match(client,/deviceApproved=data\.approved===true&&data\.status==='approved'/u);
 assert.match(client,/if\(deviceApproved\)await loadNotes\(true\)/u);
 assert.match(client,/await refreshDeviceStatus\(\)/u);
 assert.doesNotMatch(client,/navigator\.credentials\.(?:get|create)|document\.cookie|localStorage|indexedDB/u);
});
test('recheck and offline synchronously erase list, active editor and stale approval',()=>{
 const html=read('public/index.html');
 assert.match(html,/function clearProtectedUi\(\) \{[\s\S]*?deviceApproved=false;[\s\S]*?memoPanel\.hidden=true;[\s\S]*?latestLoad;[\s\S]*?currentNotes=\[\];[\s\S]*?list\.replaceChildren\(\);[\s\S]*?resetEditor\(\);[\s\S]*?memoMessage\.textContent='';/u);
 assert.match(html,/async function refreshDeviceStatus\(\) \{\s*clearProtectedUi\(\);/u);
 assert.match(html,/function updateNetworkStatus\(\) \{[\s\S]*?if\(navigator\.onLine===false\)\{\s*clearProtectedUi\(\);/u);
 assert.match(html,/if\(!deviceApproved\|\|navigator\.onLine===false\)/u);
 assert.match(html,/if \(requestNumber !== latestLoad\) return/u);
});
test('device app role cannot update approval and timestamp is mandatory',()=>{
 const schema=read('supabase/step11-device-handles.sql');
 assert.match(schema,/step11_approval_requires_timestamp/u);
 assert.match(schema,/expires_at timestamptz not null/u);
 assert.match(schema,/revoke all on public\.step11_device_handles from service_role/u);
 assert.match(schema,/grant select,insert on public\.step11_device_handles to service_role/u);
 assert.doesNotMatch(schema,/grant[^;\n]*update[^;\n]*to service_role/iu);
});
