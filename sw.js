/* 可选伴侣文件：离线 PWA 缓存。仅当把 index.html 部署到普通浏览器 http(s) 网址、且本文件
 * 与 index.html 同目录时才生效。直接双击本地 index.html（file://）或处于 Capacitor 安卓壳内不会注册 SW。
 * 主交付始终是单一 index.html；本文件可忽略，不影响单文件使用。 */
const CACHE = 'cp-app-f71a7cb5';
const SHARE_CACHE = 'cp-share-target-v1';
const SHELL = [
  './', './index.html', './sw.js', './manifest.webmanifest', './quotes-data.js',
  './icon-192.png', './icon-512.png', './icon-512-maskable.png', './apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (u) {
      return c.add(u).catch(function () { return null; });
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE && k !== SHARE_CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function matchAppShell() {
  return caches.match('./index.html', { ignoreSearch: true }).then(function (r1) {
    if (r1) return r1;
    return caches.match('index.html', { ignoreSearch: true });
  }).then(function (r2) {
    if (r2) return r2;
    return caches.match('./', { ignoreSearch: true });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;

  /* P2 第二层 Web Share Target：接收从系统相册/手环 App 直接「分享」进来的截图 */
  if (req.method === 'POST' && req.url.indexOf('share_target=1') >= 0) {
    e.respondWith(
      req.formData().then(function (formData) {
        var file = formData.get('images') || formData.get('image') || formData.get('file');
        if (!file) return Response.redirect('./index.html#/today', 303);
        return caches.open(SHARE_CACHE).then(function (c) {
          var headers = new Headers({
            'Content-Type': file.type || 'image/png',
            'X-Shared-Name': encodeURIComponent(file.name || 'shared.png')
          });
          return c.put('./__shared_image__', new Response(file, { headers: headers }));
        }).then(function () {
          return Response.redirect('./index.html?shared_shot=1#/today', 303);
        });
      }).catch(function () {
        return Response.redirect('./index.html#/today', 303);
      })
    );
    return;
  }

  if (req.method !== 'GET') return;

  /* 页面导航走 network-first：服务器有新版 index.html 就直接拿新版并刷新缓存，
   * 断网才回退缓存；绝不返回空白 504 响应以免造成 WebView 二次打开白屏。 */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) {
            c.put('./index.html', copy).catch(function () {});
          }).catch(function () {});
          return res;
        }
        return matchAppShell().then(function (cached) { return cached || res; });
      }).catch(function () {
        return matchAppShell().then(function (cached) {
          if (cached) return cached;
          return new Response(
            '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>课表 Course Planner</title></head><body style="font-family:sans-serif;padding:24px;text-align:center"><p>正在恢复页面缓存…</p><script>if(navigator.serviceWorker){navigator.serviceWorker.getRegistrations().then(function(rs){return Promise.all(rs.map(function(r){return r.unregister();}));}).finally(function(){location.reload();});}</script></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        });
      })
    );
    return;
  }

  e.respondWith(
    caches.open(CACHE).then(function (c) {
      return c.match(req, { ignoreSearch: true }).then(function (cached) {
        if (cached) return cached;
        return fetch(req).then(function (res) {
          if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()).catch(function () {});
          return res;
        }).catch(function () {
          return cached || Response.error();
        });
      });
    })
  );
});
