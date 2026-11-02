/* ==========================================================
 * 极简 ZIP 编解码（零依赖）
 * ----------------------------------------------------------
 * 只做备份包需要的事：写入一律 STORE（不压缩），读取兼容
 * STORE 与 DEFLATE（用户可能用系统压缩工具重打包过）。
 *
 * 为什么自己写：这个 App 是单文件 PWA，不引运行时依赖。
 * JPEG 本身已压缩，再包一层 DEFLATE 收益接近零，所以写侧
 * 用 STORE 最简单也最快；读侧多花一点代码兼容 deflate。
 *
 * 对外：window.Zip
 *   Zip.create([{name, bytes}]) → Uint8Array
 *   Zip.read(bytes)            → Promise<[{name, bytes}]>
 *   Zip.looksLikeZip(bytes)    → boolean
 * ========================================================== */
(function (global) {
  'use strict';

  var SIG_LOCAL = 0x04034b50;
  var SIG_CENTRAL = 0x02014b50;
  var SIG_EOCD = 0x06054b50;
  var FLAG_UTF8 = 0x0800;

  /* ---------------- CRC32 ---------------- */
  var CRC_TABLE = null;
  function crcTable() {
    if (CRC_TABLE) return CRC_TABLE;
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    CRC_TABLE = t;
    return t;
  }
  function crc32(bytes) {
    var t = crcTable(), c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---------------- 写 ---------------- */
  function Writer() {
    this.parts = [];
    this.size = 0;
  }
  Writer.prototype.push = function (u8) {
    this.parts.push(u8);
    this.size += u8.length;
  };
  Writer.prototype.u16 = function (v) {
    var b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, v & 0xFFFF, true);
    this.push(b);
  };
  Writer.prototype.u32 = function (v) {
    var b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v >>> 0, true);
    this.push(b);
  };
  Writer.prototype.bytes = function (arr) { this.push(arr); };
  Writer.prototype.done = function () {
    var out = new Uint8Array(this.size), off = 0;
    for (var i = 0; i < this.parts.length; i++) {
      out.set(this.parts[i], off);
      off += this.parts[i].length;
    }
    return out;
  };

  function dosTime(d) {
    return ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  }
  function dosDate(d) {
    var y = d.getFullYear();
    if (y < 1980) y = 1980;
    return (((y - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  }

  function toU8(bytes) {
    if (bytes instanceof Uint8Array) return bytes;
    if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
    if (bytes && bytes.buffer instanceof ArrayBuffer) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    throw new Error('zip: 需要 Uint8Array');
  }

  /**
   * 打包。files: [{name: 'a/b.jpg', bytes: Uint8Array}]
   * 全部 STORE（method 0），UTF-8 文件名。
   */
  function create(files) {
    var enc = new TextEncoder();
    var now = new Date();
    var time = dosTime(now), date = dosDate(now);
    var w = new Writer();
    var entries = [];

    (files || []).forEach(function (f) {
      if (!f || !f.name) return;
      var data = toU8(f.bytes);
      var nameBytes = enc.encode(String(f.name));
      var crc = crc32(data);

      var offset = w.size;

      // 本地文件头
      w.u32(SIG_LOCAL);
      w.u16(20);              // version needed
      w.u16(FLAG_UTF8);       // flags
      w.u16(0);               // method = store
      w.u16(time);
      w.u16(date);
      w.u32(crc);
      w.u32(data.length);     // compressed size
      w.u32(data.length);     // uncompressed size
      w.u16(nameBytes.length);
      w.u16(0);               // extra len
      w.bytes(nameBytes);
      w.bytes(data);

      entries.push({ name: nameBytes, crc: crc, size: data.length, offset: offset });
    });

    // 中央目录
    var cdStart = w.size;
    entries.forEach(function (e) {
      w.u32(SIG_CENTRAL);
      w.u16(20);              // version made by
      w.u16(20);              // version needed
      w.u16(FLAG_UTF8);
      w.u16(0);               // method
      w.u16(time);
      w.u16(date);
      w.u32(e.crc);
      w.u32(e.size);
      w.u32(e.size);
      w.u16(e.name.length);
      w.u16(0);               // extra
      w.u16(0);               // comment
      w.u16(0);               // disk start
      w.u16(0);               // internal attrs
      w.u32(0);               // external attrs
      w.u32(e.offset);
      w.bytes(e.name);
    });
    var cdSize = w.size - cdStart;

    // 中央目录结束记录
    w.u32(SIG_EOCD);
    w.u16(0);
    w.u16(0);
    w.u16(entries.length);
    w.u16(entries.length);
    w.u32(cdSize);
    w.u32(cdStart);
    w.u16(0);

    return w.done();
  }

  /* ---------------- 读 ---------------- */
  function looksLikeZip(bytes) {
    if (!bytes || bytes.length < 4) return false;
    return bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04;
  }

  function findEocd(dv, len) {
    // EOCD 之后最多 65535 字节注释，从尾部往前找
    var min = Math.max(0, len - 65557);
    for (var i = len - 22; i >= min; i--) {
      if (dv.getUint32(i, true) === SIG_EOCD) return i;
    }
    return -1;
  }

  /** deflate-raw 解压（浏览器原生，缺失时抛错） */
  function inflateRaw(bytes) {
    if (typeof global.DecompressionStream !== 'function') {
      return Promise.reject(new Error('当前环境不支持解压 deflate（请用 App 内或新版浏览器导入）'));
    }
    var ds = new global.DecompressionStream('deflate-raw');
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
  }

  /**
   * 解包。返回 Promise<[{name, bytes}]>
   */
  function read(input) {
    var bytes = toU8(input);
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var eocd = findEocd(dv, bytes.length);
    if (eocd < 0) return Promise.reject(new Error('不是有效的 zip（找不到中央目录）'));

    var count = dv.getUint16(eocd + 10, true);
    var cdOffset = dv.getUint32(eocd + 16, true);
    var dec = new TextDecoder();
    var out = [];
    var pos = cdOffset;

    var jobs = [];
    for (var i = 0; i < count; i++) {
      if (dv.getUint32(pos, true) !== SIG_CENTRAL) return Promise.reject(new Error('zip 中央目录损坏'));
      var method = dv.getUint16(pos + 10, true);
      var csize = dv.getUint32(pos + 20, true);
      var namelen = dv.getUint16(pos + 28, true);
      var extralen = dv.getUint16(pos + 30, true);
      var commentlen = dv.getUint16(pos + 32, true);
      var localOff = dv.getUint32(pos + 42, true);
      var name = dec.decode(bytes.subarray(pos + 46, pos + 46 + namelen));
      pos += 46 + namelen + extralen + commentlen;

      // 本地头里的 name/extra 长度可能与中央目录不同，以本地头为准算数据起点
      if (dv.getUint32(localOff, true) !== SIG_LOCAL) return Promise.reject(new Error('zip 本地头损坏'));
      var lNameLen = dv.getUint16(localOff + 26, true);
      var lExtraLen = dv.getUint16(localOff + 28, true);
      var dataStart = localOff + 30 + lNameLen + lExtraLen;
      var data = bytes.subarray(dataStart, dataStart + csize);

      jobs.push({ name: name, method: method, data: data });
    }

    return Promise.all(jobs.map(function (j) {
      if (j.method === 0) {
        // 复制一份，避免和源缓冲共享引用
        return Promise.resolve({ name: j.name, bytes: new Uint8Array(j.data) });
      }
      if (j.method === 8) {
        return inflateRaw(j.data).then(function (u8) { return { name: j.name, bytes: u8 }; });
      }
      return Promise.reject(new Error('zip 不支持的压缩方式 ' + j.method));
    }));
  }

  global.Zip = {
    create: create,
    read: read,
    looksLikeZip: looksLikeZip,
    crc32: crc32
  };
})(typeof window !== 'undefined' ? window : globalThis);
