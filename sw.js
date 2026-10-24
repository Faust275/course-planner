/* 可选伴侣文件：离线 PWA 缓存。仅当把 index.html 部署到 http(s) 网址、且本文件
 * 与 index.html 同目录时才生效。直接双击本地 index.html（file://）不会注册 SW。
 * 主交付始终是单一 index.html；本文件可忽略，不影响单文件使用。 */
// v2：补齐 manifest 与各尺寸图标。之前只缓存 index.html/sw.js，离线冷启动时
// manifest 与图标取不到，安装出来的桌面图标会掉成默认样式。
// v3：诗词语料外置为 quotes-data.js（800KB，首屏不再内联），要一起缓存，
// 否则离线冷启动时「每日一句」只能拿到 15KB 的迷你集。
const CACHE = 'cp-app-v3';
const SHELL = [
  './', './index.html', './sw.js', './manifest.webmanifest', './quotes-data.js',
  './icon-192.png', './icon-512.png', './icon-512-maskable.png', './apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    // 逐项 add 而不是 addAll：addAll 只要有一个 404 就整批失败，
    // 那样连 index.html 都缓存不上，离线直接打不开。这里允许个别资源缺失。
    return Promise.all(SHELL.map(function (u) {
      return c.add(u).catch(function () { return null; });
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  /* 页面导航走 network-first：服务器有新版 index.html 就直接拿新版并刷新缓存，
   * 断网才回退缓存。修复旧策略的坑——以前 index.html 也是 cache-first，
   * 而 sw.js 不变就不会重新 install，导致发新版用户永远拿不到。 */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          return caches.open(CACHE).then(function (c) {
            return c.put('./index.html', copy);
          }).then(function () { return res; });
        }
        return res;
      }).catch(function () {
        return caches.match('./index.html', { ignoreSearch: true }).then(function (cached) {
          return cached || new Response('', { status: 504 });
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
          // 连同跨域头像（含 opaque 响应）一并缓存，使离线也能显示头像
          if (res) c.put(req, res.clone());
          return res;
        }).catch(function () { return cached || new Response('', { status: 504 }); });
      });
    })
  );
});
