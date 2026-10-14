import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';

const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const html=read('public/index.html');
const manifest=JSON.parse(read('public/manifest.webmanifest'));
const offline=read('public/offline.html');
const sw=read('public/sw.js');

test('installable web app advertises correct name, start, scope and true icons',()=>{
  assert.equal(manifest.id,'/');
  assert.equal(manifest.start_url,'/');
  assert.equal(manifest.scope,'/');
  assert.equal(manifest.display,'standalone');
  assert.match(manifest.name,/BYTE BACK/u);
  assert.equal(manifest.lang,'ko');
  for(const size of [192,512]){
    const icon=manifest.icons.find(x=>x.sizes===size+'x'+size&&x.type==='image/png');
    assert.ok(icon,'Missing '+size+' icon');
    const image=readFileSync(new URL('public'+icon.src,root));
    assert.deepEqual([...image.subarray(0,8)],[137,80,78,71,13,10,26,10]);
    assert.equal(image.readUInt32BE(16),size);
    assert.equal(image.readUInt32BE(20),size);
  }
  const svgIcon=manifest.icons.find(x=>x.type==='image/svg+xml');
  assert.ok(svgIcon&&read('public'+svgIcon.src).includes('<svg'));
  assert.match(html,/<link rel="manifest" href="\/manifest\.webmanifest">/u);
  assert.match(html,/<link rel="apple-touch-icon" href="\/app-icon-192\.png">/u);
});

test('install indicator does not impersonate server device approval',()=>{
  assert.match(html,/id="device-approval-status"/u);
  assert.match(html,/서버 기기 승인: 미확인/u);
  assert.match(html,/설치했더라도 기기가 승인된 것은 아닙니다/u);
  assert.match(html,/로그인만 완료됨/u);
  assert.match(html,/서버 승인 전에는 보호 메모를 표시하거나 요청하지 않습니다/u);
  assert.doesNotMatch(html,/(?:localStorage|sessionStorage|indexedDB)\s*[.(\[]/u);
  const js=html.match(/<script type="module">([\s\S]*?)<\/script>/u)?.[1];
  assert.ok(js,'missing UI script');
  assert.doesNotThrow(()=>new Script(js,{filename:'inline-pwa-shell.js'}));
  assert.match(html,/fetch\('\/api\/memos'/u);
  assert.match(html,/\/api\/auth\/session/u);
});

test('offline service worker cannot cache or replace protected API responses',()=>{
  assert.deepEqual(JSON.parse(JSON.stringify(manifest.icons.map(x=>x.src))).length,3);
  assert.match(sw,/startsWith\('\/api\/'\)/u);
  assert.match(sw,/event\.request\.mode !== 'navigate'/u);
  assert.match(sw,/const OFFLINE_HTML = /u);
  assert.match(sw,/new Response\(OFFLINE_HTML/u);
  // Purge old cache entries, but do not write anything back to browser storage.
  assert.match(sw,/caches\.delete\(key\)/u);
  assert.doesNotMatch(sw,/caches\.(?:open|match)/u);
  assert.doesNotMatch(sw,/\b(?:cache\.put|cache\.add|cache\.addAll)\(/u);
  assert.match(sw,/Cache-Control': 'no-store'/u);
  assert.match(offline,/오프라인에서 메모나 인증 정보를 제공하지 않습니다/u);
  assert.doesNotMatch(offline,/(?:localStorage|sessionStorage|indexedDB)/u);
});
