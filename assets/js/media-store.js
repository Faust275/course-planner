/* ==========================================================
 * 饮食照片存储（独立 IndexedDB：cp-media/photos）
 * ----------------------------------------------------------
 * 为什么不复用 cp-store：主状态库是「整份状态字符串」的 KV，走 localStorage
 * 兜底；照片是二进制大块，混进去一旦 IDB 降级就会把 localStorage 撑爆。
 * 所以单开一个库，专门放压缩后的 JPEG Blob，和状态持久化彻底隔离。
 * 对外只暴露 window.Media。
 * ========================================================== */
(function (global) {
  'use strict';

  var DB_NAME = 'cp-media';
  var STORE = 'photos';
  var VERSION = 1;
  var MAX_EDGE = 1080;
  var QUALITY = 0.7;

  var dbPromise = null;
  var broken = false;
  var urlCache = {};   // key -> objectURL（会话内复用，删除时 revoke）

  function idbOK() {
    if (broken) return false;
    try {
      var p = global.location && global.location.protocol;
      return typeof indexedDB !== 'undefined' && indexedDB !== null &&
        (p === 'http:' || p === 'https:' || p === 'capacitor:' || p === 'ionic:');
    } catch (e) { return false; }
  }

  function openDB() {
    if (broken) return Promise.reject(new Error('media-broken'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req;
      try { req = indexedDB.open(DB_NAME, VERSION); }
      catch (e) { broken = true; reject(e); return; }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { broken = true; dbPromise = null; reject(req.error || new Error('media-error')); };
      req.onblocked = function () { broken = true; dbPromise = null; reject(new Error('media-blocked')); };
    });
    return dbPromise;
  }

  function uid() {
    return 'm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function dataURLtoBlob(d) {
    var parts = String(d).split(',');
    var mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
    var bin = atob(parts[1]);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  /**
   * 把用户选的照片压成长边 ≤ maxEdge 的 JPEG Blob
   * （手机原图动辄 3–8MB，不压会很快吃掉 IDB 配额）
   */
  function compress(file, maxEdge, quality) {
    maxEdge = maxEdge || MAX_EDGE;
    quality = quality || QUALITY;
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.width, h = img.height;
          var scale = Math.min(1, maxEdge / Math.max(w, h));
          var W = Math.max(1, Math.round(w * scale));
          var H = Math.max(1, Math.round(h * scale));
          var c = document.createElement('canvas');
          c.width = W; c.height = H;
          var ctx = c.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, W, H);
          ctx.drawImage(img, 0, 0, W, H);
          URL.revokeObjectURL(url);
          if (c.toBlob) {
            c.toBlob(function (b) {
              if (b) resolve(b); else reject(new Error('图片编码失败'));
            }, 'image/jpeg', quality);
          } else {
            resolve(dataURLtoBlob(c.toDataURL('image/jpeg', quality)));
          }
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
      img.src = url;
    });
  }

  /** 存一张照片，返回 key；IDB 不可用返回 null */
  function put(blob) {
    if (!idbOK() || !blob) return Promise.resolve(null);
    var key = uid();
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(blob, key);
        tx.oncomplete = function () { resolve(key); };
        tx.onerror = function () { reject(tx.error || new Error('写入失败')); };
      });
    }).catch(function () { return null; });
  }

  /** 取展示用 objectURL（会话内缓存） */
  function getUrl(key) {
    if (!key) return Promise.resolve('');
    if (urlCache[key]) return Promise.resolve(urlCache[key]);
    if (!idbOK()) return Promise.resolve('');
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE, 'readonly');
        var r = tx.objectStore(STORE).get(key);
        r.onsuccess = function () {
          var blob = r.result;
          if (!blob) { resolve(''); return; }
          try {
            var u = URL.createObjectURL(blob);
            urlCache[key] = u;
            resolve(u);
          } catch (e) { resolve(''); }
        };
        r.onerror = function () { resolve(''); };
      });
    }).catch(function () { return ''; });
  }

  /** 删除若干张（连带 revoke objectURL） */
  function del(keys) {
    keys = (keys || []).filter(Boolean);
    if (!keys.length) return Promise.resolve();
    keys.forEach(function (k) {
      if (urlCache[k]) {
        try { URL.revokeObjectURL(urlCache[k]); } catch (e) {}
        delete urlCache[k];
      }
    });
    if (!idbOK()) return Promise.resolve();
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE, 'readwrite');
        var os = tx.objectStore(STORE);
        keys.forEach(function (k) { os.delete(k); });
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { resolve(); };
      });
    }).catch(function () {});
  }

  /** 清空全部（重置数据时调用） */
  function clearAll() {
    Object.keys(urlCache).forEach(function (k) {
      try { URL.revokeObjectURL(urlCache[k]); } catch (e) {}
    });
    urlCache = {};
    if (!idbOK()) return Promise.resolve();
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { resolve(); };
      });
    }).catch(function () {});
  }

  /** 按指定 key 写回（备份恢复用，保证 meals 里的 key 对得上） */
  function putAt(key, blob) {
    if (!idbOK() || !key || !blob) return Promise.resolve(null);
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(blob, key);
        tx.oncomplete = function () { resolve(key); };
        tx.onerror = function () { reject(tx.error || new Error('写入失败')); };
      });
    }).catch(function () { return null; });
  }

  /** 取出全部照片 [{key, blob}]，备份打包用 */
  function all() {
    if (!idbOK()) return Promise.resolve([]);
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE, 'readonly');
        var os = tx.objectStore(STORE);
        var out = [];
        var req = os.openCursor();
        req.onsuccess = function () {
          var cur = req.result;
          if (!cur) { resolve(out); return; }
          if (cur.value) out.push({ key: String(cur.key), blob: cur.value });
          cur.continue();
        };
        req.onerror = function () { resolve(out); };
      });
    }).catch(function () { return []; });
  }

  /** 只取 Blob（不建 objectURL），备份用 */
  function getBlob(key) {
    if (!key || !idbOK()) return Promise.resolve(null);
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE, 'readonly');
        var r = tx.objectStore(STORE).get(key);
        r.onsuccess = function () { resolve(r.result || null); };
        r.onerror = function () { resolve(null); };
      });
    }).catch(function () { return null; });
  }

  /** 统计张数与总字节，设置页展示用 */
  function usage() {
    return all().then(function (list) {
      var bytes = 0;
      list.forEach(function (x) { bytes += (x.blob && x.blob.size) || 0; });
      return { count: list.length, bytes: bytes };
    });
  }

  global.Media = {
    compress: compress,
    put: put,
    putAt: putAt,
    getUrl: getUrl,
    getBlob: getBlob,
    all: all,
    usage: usage,
    del: del,
    clearAll: clearAll,
    isAvailable: idbOK
  };
})(window);
