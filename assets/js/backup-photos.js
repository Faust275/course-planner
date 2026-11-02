/* ==========================================================
 * 带照片的备份包
 * ----------------------------------------------------------
 * 结构（STORE 模式的 zip，Windows 资源管理器可直接双击打开）：
 *   backup.json          与旧的纯 JSON 备份完全一致，可单独取出用
 *   photos/m_xxx.jpg     每餐图片，文件名就是 IndexedDB 里的 key
 *
 * 为什么不在 JSON 里内联 base64：照片总量动辄十几 MB，base64 再涨
 * 三分之一，且解析一个巨大 JSON 字符串既慢又吃内存。zip 里存原始
 * JPEG，体积最小，用户还能直接翻看。
 *
 * 对外：window.BackupPhotos
 * ========================================================== */
(function (global) {
  'use strict';

  var MANIFEST = 'backup.json';
  var DIR = 'photos/';

  var MIME_BY_EXT = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif'
  };

  function extOf(mime, fallback) {
    var m = String(mime || '').toLowerCase();
    if (m.indexOf('png') >= 0) return 'png';
    if (m.indexOf('webp') >= 0) return 'webp';
    if (m.indexOf('gif') >= 0) return 'gif';
    if (m.indexOf('jpeg') >= 0 || m.indexOf('jpg') >= 0) return 'jpg';
    return fallback || 'jpg';
  }

  function blobToU8(blob) {
    if (!blob) return Promise.resolve(new Uint8Array(0));
    if (blob.arrayBuffer) {
      return blob.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    }
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(new Uint8Array(fr.result)); };
      fr.onerror = function () { reject(fr.error || new Error('读取照片失败')); };
      fr.readAsArrayBuffer(blob);
    });
  }

  /**
   * 打包成 zip 字节。
   * @param {string} jsonText  Store.exportJSON 的结果
   * @param {{onProgress?:function}} opts
   * @returns {Promise<{bytes:Uint8Array, count:number, photoBytes:number, skipped:number}>}
   */
  function pack(jsonText, opts) {
    var onProgress = (opts && opts.onProgress) || function () {};
    var list = [];
    var count = 0, photoBytes = 0, skipped = 0;

    var collect = (global.Media && global.Media.all)
      ? global.Media.all()
      : Promise.resolve([]);

    return collect.then(function (photos) {
      photos = photos || [];
      onProgress(0, photos.length);
      var chain = Promise.resolve();
      photos.forEach(function (p, i) {
        chain = chain.then(function () {
          return blobToU8(p.blob).then(function (u8) {
            if (!u8.length) { skipped++; return; }
            list.push({
              name: DIR + p.key + '.' + extOf(p.blob && p.blob.type),
              bytes: u8
            });
            count++;
            photoBytes += u8.length;
            onProgress(i + 1, photos.length);
          }).catch(function () { skipped++; });
        });
      });
      return chain;
    }).then(function () {
      // backup.json 放最前，方便用户解压后第一眼看到
      var enc = new TextEncoder();
      var files = [{ name: MANIFEST, bytes: enc.encode(jsonText) }].concat(list);
      return {
        bytes: global.Zip.create(files),
        count: count,
        photoBytes: photoBytes,
        skipped: skipped
      };
    });
  }

  /**
   * 解包。返回 {json, photos:[{key, mime, bytes}]}
   * @param {Uint8Array|ArrayBuffer} input
   */
  function unpack(input) {
    return global.Zip.read(input).then(function (entries) {
      var json = '';
      var photos = [];
      entries.forEach(function (e) {
        var name = String(e.name || '');
        if (name === MANIFEST || (!json && /(^|\/)backup\.json$/i.test(name))) {
          json = new TextDecoder().decode(e.bytes);
          return;
        }
        if (name.indexOf(DIR) !== 0) return;
        var base = name.slice(DIR.length);
        if (!base || base.charAt(base.length - 1) === '/') return;
        if (base.indexOf('__MACOSX') >= 0) return;
        var dot = base.lastIndexOf('.');
        var key = dot > 0 ? base.slice(0, dot) : base;
        var ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : 'jpg';
        if (!key) return;
        photos.push({ key: key, mime: MIME_BY_EXT[ext] || 'image/jpeg', bytes: e.bytes });
      });
      return { json: json, photos: photos };
    });
  }

  /**
   * 把解包出来的照片写回 IndexedDB。
   * @returns {Promise<{restored:number, failed:number, unavailable:boolean}>}
   */
  function restore(photos) {
    var list = photos || [];
    if (!list.length) return Promise.resolve({ restored: 0, failed: 0, unavailable: false });
    if (!(global.Media && global.Media.isAvailable && global.Media.isAvailable())) {
      return Promise.resolve({ restored: 0, failed: list.length, unavailable: true });
    }
    var restored = 0, failed = 0;
    var chain = Promise.resolve();
    list.forEach(function (p) {
      chain = chain.then(function () {
        var blob;
        try { blob = new Blob([p.bytes], { type: p.mime || 'image/jpeg' }); }
        catch (e) { failed++; return; }
        return global.Media.putAt(p.key, blob).then(function (k) {
          if (k) restored++; else failed++;
        }).catch(function () { failed++; });
      });
    });
    return chain.then(function () {
      return { restored: restored, failed: failed, unavailable: false };
    });
  }

  global.BackupPhotos = {
    MANIFEST: MANIFEST,
    DIR: DIR,
    pack: pack,
    unpack: unpack,
    restore: restore,
    extOf: extOf
  };
})(typeof window !== 'undefined' ? window : globalThis);
