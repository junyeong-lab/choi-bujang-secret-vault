// Step 11: offline information is generated from this trusted, public script.
// No persistent Cache Storage writes: never persist device/session material.
const OFFLINE_HTML = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>오프라인 안내 | BYTE BACK</title>
<style>body{font-family:system-ui,sans-serif;background:#101a28;color:#f0f5ff;margin:0;padding:48px 20px}
main{max-width:520px;margin:auto}p{line-height:1.7;color:#d0e2ec}</style></head>
<body><main><h1>네트워크 연결이 필요합니다</h1>
<p>오프라인에서는 로그인 확인과 보호 자료에 접근할 수 없습니다.</p>
<p>앱 설치는 기기 승인을 의미하지 않습니다. 연결 후 다시 인증해 주세요.</p></main></body></html>`;
self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', event => {
  // One-time cleanup of public offline assets cached by the earlier version.
  // Never touch unrelated caches belonging to other applications.
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('byte-back-public-offline-'))
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Never intercept protected APIs, signed challenges or non-navigation requests.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') ||
      event.request.mode !== 'navigate' || event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).catch(() => new Response(OFFLINE_HTML, {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  })));
});
