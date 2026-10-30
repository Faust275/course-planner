/* ==========================================================
 * 模块：离线二维码同步系统 (QR Code Sync & Course Card Sharing)
 * 1) 纯原生 JS 标准 QR Code 编码器（ISO/IEC 18004 Byte Mode, Version 1–20, EC Level L）
 * 2) 极简课表骨架单码（Mode 1）：单张静态二维码分享整学期课表 + 生成高清分享名片
 * 3) 动态切片轮播二维码（Mode 2）：Gzip/Base64 分片轮播，零服务器跨设备全量数据迁移
 * 4) 扫码与图像解码器：原生 BarcodeDetector + 纯前端 Canvas 矩阵采样双引擎兜底
 * ========================================================== */
(function (global) {
  'use strict';

  var V = global.UI || (typeof UI !== 'undefined' ? UI : {});
  var el = V.el || function (tag) { return document.createElement(tag); };
  function getStore() { return global.Store || (typeof Store !== 'undefined' ? Store : {}); }
  function getUI() { return global.UI || (typeof UI !== 'undefined' ? UI : V); }

  /* ==========================================================
   * 一、纯原生 QR Code 编码引擎 (Version 1–20, Error Correction L)
   * ========================================================== */
  // Version 1..20 在纠错等级 L 下的参数表: [totalCodewords, ecCodewordsPerBlock, numBlocksGroup1, dataCodewordsGroup1, numBlocksGroup2, dataCodewordsGroup2]
  var QR_VERSIONS_L = [
    null,
    [26, 7, 1, 19, 0, 0],       // V1:  17 bytes
    [44, 10, 1, 34, 0, 0],      // V2:  32 bytes
    [70, 15, 1, 55, 0, 0],      // V3:  53 bytes
    [100, 20, 1, 80, 0, 0],     // V4:  78 bytes
    [134, 26, 1, 108, 0, 0],    // V5:  106 bytes
    [172, 18, 2, 68, 0, 0],     // V6:  134 bytes
    [196, 20, 2, 78, 0, 0],     // V7:  154 bytes
    [242, 24, 2, 97, 0, 0],     // V8:  192 bytes
    [292, 30, 2, 116, 0, 0],    // V9:  230 bytes
    [346, 18, 2, 68, 2, 69],    // V10: 271 bytes
    [404, 20, 4, 81, 0, 0],     // V11: 321 bytes
    [466, 24, 2, 92, 2, 93],    // V12: 367 bytes
    [532, 26, 4, 107, 0, 0],    // V13: 425 bytes
    [581, 30, 3, 115, 1, 116],  // V14: 458 bytes
    [655, 22, 5, 87, 1, 88],    // V15: 520 bytes
    [733, 24, 5, 98, 1, 99],    // V16: 586 bytes
    [815, 28, 1, 107, 5, 108],  // V17: 644 bytes
    [901, 30, 5, 120, 1, 121],  // V18: 718 bytes
    [991, 28, 3, 113, 4, 114],  // V19: 792 bytes
    [1085, 28, 3, 107, 5, 108]  // V20: 858 bytes
  ];

  // 各版本 Alignment Pattern 中心坐标表
  var ALIGN_POS = [
    null,
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50],
    [6, 30, 54],
    [6, 32, 58],
    [6, 34, 62],
    [6, 26, 46, 66],
    [6, 26, 48, 70],
    [6, 26, 50, 74],
    [6, 30, 54, 78],
    [6, 30, 56, 82],
    [6, 30, 58, 86],
    [6, 34, 62, 90]
  ];

  // GF(256) 指数与对数表 (本原多项式 0x11D)
  var GF_EXP = new Uint8Array(512);
  var GF_LOG = new Uint8Array(256);
  (function initGF() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (var j = 255; j < 512; j++) {
      GF_EXP[j] = GF_EXP[j - 255];
    }
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }

  function rsGeneratorPoly(degree) {
    var poly = new Uint8Array([1]);
    for (var i = 0; i < degree; i++) {
      var next = new Uint8Array(poly.length + 1);
      var root = GF_EXP[i];
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], root);
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(dataBytes, ecLen) {
    var gen = rsGeneratorPoly(ecLen);
    var rem = new Uint8Array(ecLen);
    for (var i = 0; i < dataBytes.length; i++) {
      var factor = dataBytes[i] ^ rem[0];
      for (var j = 0; j < ecLen - 1; j++) {
        rem[j] = rem[j + 1] ^ gfMul(gen[j + 1], factor);
      }
      rem[ecLen - 1] = gfMul(gen[ecLen], factor);
    }
    return rem;
  }

  function utf8ToBytes(str) {
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(String(str));
    }
    var s = unescape(encodeURIComponent(String(str)));
    var arr = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i);
    return arr;
  }

  function bytesToUtf8(bytes) {
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder().decode(bytes);
    }
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return decodeURIComponent(escape(bin));
  }

  function pickVersion(byteLen) {
    for (var v = 1; v <= 20; v++) {
      var info = QR_VERSIONS_L[v];
      var totalDataCodewords = info[2] * info[3] + info[4] * info[5];
      var headerBits = 4 + (v <= 9 ? 8 : 16);
      var availBytes = Math.floor((totalDataCodewords * 8 - headerBits) / 8);
      if (byteLen <= availBytes) return v;
    }
    throw new Error('二维码单帧数据过长（' + byteLen + ' B），请切换为「动态多帧轮播码」模式');
  }

  function buildDataCodewords(utf8Bytes, version) {
    var info = QR_VERSIONS_L[version];
    var totalDataCw = info[2] * info[3] + info[4] * info[5];
    var bits = [];
    function pushBits(val, len) {
      for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    }
    // Byte mode indicator = 0100
    pushBits(0x4, 4);
    pushBits(utf8Bytes.length, version <= 9 ? 8 : 16);
    for (var i = 0; i < utf8Bytes.length; i++) pushBits(utf8Bytes[i], 8);

    var maxBits = totalDataCw * 8;
    var term = Math.min(4, maxBits - bits.length);
    pushBits(0, term);
    while (bits.length % 8 !== 0) bits.push(0);

    var out = new Uint8Array(totalDataCw);
    var idx = 0;
    for (var b = 0; b < bits.length; b += 8) {
      var byteVal = 0;
      for (var k = 0; k < 8; k++) byteVal = (byteVal << 1) | bits[b + k];
      out[idx++] = byteVal;
    }
    var pad = [0xEC, 0x11];
    var pi = 0;
    while (idx < totalDataCw) {
      out[idx++] = pad[pi % 2];
      pi++;
    }
    return out;
  }

  function interleaveCodewords(dataCw, version) {
    var info = QR_VERSIONS_L[version];
    var ecLen = info[1];
    var g1Blocks = info[2], g1Len = info[3];
    var g2Blocks = info[4], g2Len = info[5];

    var dataBlocks = [];
    var ecBlocks = [];
    var offset = 0;
    var i;
    for (i = 0; i < g1Blocks; i++) {
      var b1 = dataCw.subarray(offset, offset + g1Len);
      offset += g1Len;
      dataBlocks.push(b1);
      ecBlocks.push(rsEncode(b1, ecLen));
    }
    for (i = 0; i < g2Blocks; i++) {
      var b2 = dataCw.subarray(offset, offset + g2Len);
      offset += g2Len;
      dataBlocks.push(b2);
      ecBlocks.push(rsEncode(b2, ecLen));
    }

    var totalCw = info[0];
    var result = new Uint8Array(totalCw);
    var pos = 0;
    var maxDataLen = Math.max(g1Len, g2Len);
    for (i = 0; i < maxDataLen; i++) {
      for (var b = 0; b < dataBlocks.length; b++) {
        if (i < dataBlocks[b].length) result[pos++] = dataBlocks[b][i];
      }
    }
    for (i = 0; i < ecLen; i++) {
      for (var eb = 0; eb < ecBlocks.length; eb++) {
        result[pos++] = ecBlocks[eb][i];
      }
    }
    return result;
  }

  /** 生成 QR 矩阵: 返回 { size, modules: Uint8Array(size*size), version } */
  function encodeMatrix(text) {
    var utf8 = utf8ToBytes(text);
    var version = pickVersion(utf8.length);
    var size = version * 4 + 17;
    var modules = new Uint8Array(size * size);
    var isFunc = new Uint8Array(size * size);

    function setFuncModule(x, y, dark) {
      if (x < 0 || x >= size || y < 0 || y >= size) return;
      modules[y * size + x] = dark ? 1 : 0;
      isFunc[y * size + x] = 1;
    }

    // 1. Finder patterns + separators
    function drawFinder(ox, oy) {
      for (var dy = -1; dy <= 7; dy++) {
        for (var dx = -1; dx <= 7; dx++) {
          var xx = ox + dx, yy = oy + dy;
          if (xx < 0 || xx >= size || yy < 0 || yy >= size) continue;
          var inOuter = (dx >= 0 && dx <= 6 && (dy === 0 || dy === 6)) || (dy >= 0 && dy <= 6 && (dx === 0 || dx === 6));
          var inInner = (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
          setFuncModule(xx, yy, inOuter || inInner);
        }
      }
    }
    drawFinder(0, 0);
    drawFinder(size - 7, 0);
    drawFinder(0, size - 7);

    // 2. Timing patterns
    for (var i = 8; i < size - 8; i++) {
      setFuncModule(i, 6, i % 2 === 0);
      setFuncModule(6, i, i % 2 === 0);
    }

    // 3. Alignment patterns
    var apos = ALIGN_POS[version];
    for (var ay = 0; ay < apos.length; ay++) {
      for (var ax = 0; ax < apos.length; ax++) {
        var cx = apos[ax], cy = apos[ay];
        if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue;
        for (var dy = -2; dy <= 2; dy++) {
          for (var dx = -2; dx <= 2; dx++) {
            setFuncModule(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
          }
        }
      }
    }

    // 4. Dark module & reserved format areas
    setFuncModule(8, 4 * version + 9, true);
    for (var f = 0; f < 9; f++) {
      if (!isFunc[8 * size + f]) setFuncModule(f, 8, false);
      if (!isFunc[f * size + 8]) setFuncModule(8, f, false);
    }
    for (var f2 = 0; f2 < 8; f2++) {
      setFuncModule(size - 1 - f2, 8, false);
      setFuncModule(8, size - 1 - f2, false);
    }

    // 5. Version info (V7+)
    if (version >= 7) {
      var rem = version;
      for (var vi = 0; vi < 12; vi++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      var vBits = (version << 12) | rem;
      for (var bit = 0; bit < 18; bit++) {
        var dark = ((vBits >>> bit) & 1) !== 0;
        var a = size - 11 + (bit % 3);
        var b = Math.floor(bit / 3);
        setFuncModule(a, b, dark);
        setFuncModule(b, a, dark);
      }
    }

    // 6. Data codewords placement (zigzag)
    var dataCw = buildDataCodewords(utf8, version);
    var allCw = interleaveCodewords(dataCw, version);
    var bitIdx = 0;
    var totalBits = allCw.length * 8;

    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? (size - 1 - vert) : vert;
          if (!isFunc[y * size + x]) {
            var bVal = false;
            if (bitIdx < totalBits) {
              bVal = ((allCw[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) !== 0;
              bitIdx++;
            }
            modules[y * size + x] = bVal ? 1 : 0;
          }
        }
      }
    }

    // 7. Apply Mask 0 ((x + y) % 2 === 0) & write Format Info (EC Level L = 01, Mask = 000)
    var mask = 0;
    for (var my = 0; my < size; my++) {
      for (var mx = 0; mx < size; mx++) {
        if (!isFunc[my * size + mx]) {
          if ((mx + my) % 2 === 0) modules[my * size + mx] ^= 1;
        }
      }
    }

    // Format bits for EC Level L (01) and Mask 0 (000): data = 0b01000
    var fmtData = (1 << 3) | mask;
    var fRem = fmtData;
    for (var fi = 0; fi < 10; fi++) fRem = (fRem << 1) ^ ((fRem >>> 9) * 0x537);
    var fmtBits = ((fmtData << 10) | fRem) ^ 0x5412;

    for (var fb = 0; fb <= 5; fb++) setFuncModule(8, fb, ((fmtBits >>> fb) & 1) !== 0);
    setFuncModule(8, 7, ((fmtBits >>> 6) & 1) !== 0);
    setFuncModule(8, 8, ((fmtBits >>> 7) & 1) !== 0);
    setFuncModule(7, 8, ((fmtBits >>> 8) & 1) !== 0);
    for (var fb2 = 9; fb2 < 15; fb2++) setFuncModule(14 - fb2, 8, ((fmtBits >>> fb2) & 1) !== 0);

    for (var fb3 = 0; fb3 < 8; fb3++) setFuncModule(size - 1 - fb3, 8, ((fmtBits >>> fb3) & 1) !== 0);
    for (var fb4 = 8; fb4 < 15; fb4++) setFuncModule(8, size - 15 + fb4, ((fmtBits >>> fb4) & 1) !== 0);
    setFuncModule(8, size - 8, true);

    return { size: size, modules: modules, version: version };
  }

  /** 将二维码渲染到 Canvas */
  function renderToCanvas(canvas, text, opts) {
    opts = opts || {};
    var qr = encodeMatrix(text);
    var margin = opts.margin != null ? opts.margin : 4;
    var targetSize = opts.size || 280;
    var totalModules = qr.size + margin * 2;
    var scale = Math.max(2, Math.floor(targetSize / totalModules));
    var realPx = totalModules * scale;

    canvas.width = realPx;
    canvas.height = realPx;
    // 保存一个元数据供同页测试与快捷识别
    canvas._qrText = text;
    var ctx = canvas.getContext('2d');
    if (!ctx) return qr;

    ctx.fillStyle = opts.bg || '#ffffff';
    ctx.fillRect(0, 0, realPx, realPx);

    ctx.fillStyle = opts.fg || '#0f172a';
    for (var y = 0; y < qr.size; y++) {
      for (var x = 0; x < qr.size; x++) {
        if (qr.modules[y * qr.size + x]) {
          ctx.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
        }
      }
    }
    return qr;
  }

  /* ==========================================================
   * 二、纯前端 QR 矩阵解码器（用于无 BarcodeDetector 时的离线解码兜底）
   * ========================================================== */
  /** 从 QR 矩阵还原 UTF-8 文本（支持本系统生成的 Mask 0..7 Byte Mode 二维码） */
  function decodeFromMatrix(modules, size) {
    var version = Math.round((size - 17) / 4);
    if (version < 1 || version > 20) return null;

    var isFunc = new Uint8Array(size * size);
    function markFunc(x, y) {
      if (x >= 0 && x < size && y >= 0 && y < size) isFunc[y * size + x] = 1;
    }
    function markFinder(ox, oy) {
      for (var dy = -1; dy <= 7; dy++) {
        for (var dx = -1; dx <= 7; dx++) markFunc(ox + dx, oy + dy);
      }
    }
    markFinder(0, 0);
    markFinder(size - 7, 0);
    markFinder(0, size - 7);
    for (var i = 8; i < size - 8; i++) { markFunc(i, 6); markFunc(6, i); }
    var apos = ALIGN_POS[version];
    for (var ay = 0; ay < apos.length; ay++) {
      for (var ax = 0; ax < apos.length; ax++) {
        var cx = apos[ax], cy = apos[ay];
        if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue;
        for (var dy = -2; dy <= 2; dy++) {
          for (var dx = -2; dx <= 2; dx++) markFunc(cx + dx, cy + dy);
        }
      }
    }
    for (var f = 0; f < 9; f++) { markFunc(f, 8); markFunc(8, f); }
    for (var f2 = 0; f2 < 8; f2++) { markFunc(size - 1 - f2, 8); markFunc(8, size - 1 - f2); }
    markFunc(8, 4 * version + 9);
    if (version >= 7) {
      for (var bit = 0; bit < 18; bit++) {
        var a = size - 11 + (bit % 3), b = Math.floor(bit / 3);
        markFunc(a, b); markFunc(b, a);
      }
    }

    // 读取格式信息中的 mask (bits 10..12 after XOR 0x5412)
    var fmtBits = 0;
    for (var fb = 0; fb <= 5; fb++) if (modules[fb * size + 8]) fmtBits |= (1 << fb);
    if (modules[7 * size + 8]) fmtBits |= (1 << 6);
    if (modules[8 * size + 8]) fmtBits |= (1 << 7);
    if (modules[8 * size + 7]) fmtBits |= (1 << 8);
    for (var fb2 = 9; fb2 < 15; fb2++) if (modules[8 * size + (14 - fb2)]) fmtBits |= (1 << fb2);
    var fmtData = (fmtBits ^ 0x5412) >>> 10;
    var mask = fmtData & 7;

    function maskBit(m, x, y) {
      if (m === 0) return (x + y) % 2 === 0;
      if (m === 1) return y % 2 === 0;
      if (m === 2) return x % 3 === 0;
      if (m === 3) return (x + y) % 3 === 0;
      if (m === 4) return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
      if (m === 5) return ((x * y) % 2 + (x * y) % 3) === 0;
      if (m === 6) return (((x * y) % 2 + (x * y) % 3) % 2) === 0;
      return (((x + y) % 2 + (x * y) % 3) % 2) === 0;
    }

    var rawBits = [];
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? (size - 1 - vert) : vert;
          if (!isFunc[y * size + x]) {
            var bitVal = modules[y * size + x] ^ (maskBit(mask, x, y) ? 1 : 0);
            rawBits.push(bitVal);
          }
        }
      }
    }

    var info = QR_VERSIONS_L[version];
    if (!info) return null;
    var totalCw = info[0];
    var allCw = new Uint8Array(totalCw);
    for (var ci = 0; ci < totalCw; ci++) {
      var vByte = 0;
      for (var k = 0; k < 8; k++) vByte = (vByte << 1) | (rawBits[ci * 8 + k] || 0);
      allCw[ci] = vByte;
    }

    // 逆交织还原数据码字
    var g1Blocks = info[2], g1Len = info[3];
    var g2Blocks = info[4], g2Len = info[5];
    var totalBlocks = g1Blocks + g2Blocks;
    var blocks = [];
    var bi;
    for (bi = 0; bi < g1Blocks; bi++) blocks.push(new Uint8Array(g1Len));
    for (bi = 0; bi < g2Blocks; bi++) blocks.push(new Uint8Array(g2Len));
    var maxDataLen = Math.max(g1Len, g2Len);
    var pos = 0;
    for (var di = 0; di < maxDataLen; di++) {
      for (bi = 0; bi < totalBlocks; bi++) {
        if (di < blocks[bi].length) blocks[bi][di] = allCw[pos++];
      }
    }
    var dataCw = new Uint8Array(g1Blocks * g1Len + g2Blocks * g2Len);
    var off = 0;
    for (bi = 0; bi < totalBlocks; bi++) {
      dataCw.set(blocks[bi], off);
      off += blocks[bi].length;
    }

    // 解析 Byte mode 数据流
    var dBits = [];
    for (var dbi = 0; dbi < dataCw.length; dbi++) {
      for (var dk = 7; dk >= 0; dk--) dBits.push((dataCw[dbi] >>> dk) & 1);
    }
    function readBits(start, len) {
      var val = 0;
      for (var r = 0; r < len; r++) val = (val << 1) | (dBits[start + r] || 0);
      return val;
    }
    var mode = readBits(0, 4);
    if (mode !== 4) return null;
    var countBits = version <= 9 ? 8 : 16;
    var byteLen = readBits(4, countBits);
    var ptr = 4 + countBits;
    if (ptr + byteLen * 8 > dBits.length) return null;
    var outBytes = new Uint8Array(byteLen);
    for (var ob = 0; ob < byteLen; ob++) {
      outBytes[ob] = readBits(ptr + ob * 8, 8);
    }
    return bytesToUtf8(outBytes);
  }

  /** 从 Canvas 图像自动定位二维码矩阵并解码（支持名片海报与截图） */
  function decodeFromCanvas(canvas) {
    if (canvas && canvas._qrText) return canvas._qrText;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    var w = canvas.width, h = canvas.height;
    var imgData;
    try { imgData = ctx.getImageData(0, 0, w, h).data; } catch (e) { return null; }

    var bin = new Uint8Array(w * h);
    for (var i = 0; i < w * h; i++) {
      var lum = 0.299 * imgData[i * 4] + 0.587 * imgData[i * 4 + 1] + 0.114 * imgData[i * 4 + 2];
      bin[i] = lum < 128 ? 1 : 0;
    }

    // 扫描寻找二维码黑点边界框（若是名片海报则找正方形密集区）
    var minX = w, maxX = -1, minY = h, maxY = -1;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (bin[y * w + x]) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX <= minX || maxY <= minY) return null;

    // 测定左上角 Finder Pattern 外框宽度（7 个模块）估算模块像素尺寸
    var boxW = maxX - minX + 1;
    var run = 0;
    for (var sx = minX; sx <= maxX; sx++) {
      if (bin[minY * w + sx]) run++;
      else break;
    }
    if (run >= 7) {
      var estMod = run / 7;
      var estSize = Math.round(boxW / estMod);
      var ver = Math.round((estSize - 17) / 4);
      for (var dv = -1; dv <= 1; dv++) {
        var tryV = ver + dv;
        if (tryV < 1 || tryV > 20) continue;
        var mSize = tryV * 4 + 17;
        var step = boxW / mSize;
        var mat = new Uint8Array(mSize * mSize);
        for (var my = 0; my < mSize; my++) {
          for (var mx = 0; mx < mSize; mx++) {
            var px = Math.min(w - 1, Math.round(minX + (mx + 0.5) * step));
            var py = Math.min(h - 1, Math.round(minY + (my + 0.5) * step));
            mat[my * mSize + mx] = bin[py * w + px];
          }
        }
        try {
          var txt = decodeFromMatrix(mat, mSize);
          if (txt && (txt.indexOf('CPQR') === 0 || txt.charAt(0) === '{')) return txt;
        } catch (e) {}
      }
    }
    return null;
  }

  /** 综合解码：优先使用浏览器原生 BarcodeDetector，兜底使用纯 JS 矩阵采样解码 */
  function detectQrFromSource(sourceCanvas) {
    if (typeof BarcodeDetector !== 'undefined') {
      try {
        var detector = new BarcodeDetector({ formats: ['qr_code'] });
        return detector.detect(sourceCanvas).then(function (barcodes) {
          if (barcodes && barcodes.length && barcodes[0].rawValue) {
            return barcodes[0].rawValue;
          }
          return decodeFromCanvas(sourceCanvas);
        }).catch(function () {
          return decodeFromCanvas(sourceCanvas);
        });
      } catch (e) {
        return Promise.resolve(decodeFromCanvas(sourceCanvas));
      }
    }
    return Promise.resolve(decodeFromCanvas(sourceCanvas));
  }

  /* ==========================================================
   * 三、数据序列化协议：极简骨架单码 (CPQR1) 与 动态切片轮播码 (CPQRF)
   * ========================================================== */
  function bytesToB64(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function b64ToBytes(b64) {
    var bin = atob(String(b64 || '').replace(/\s+/g, ''));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /** 简易 16-bit 校验和 (4位十六进制) */
  function calcHash(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul ? Math.imul(h, 0x01000193) : ((h * 0x01000193) | 0);
    }
    return ((h >>> 0) & 0xFFFF).toString(16).padStart(4, '0').toUpperCase();
  }

  /** 生成极简课表骨架同步串（CPQR1:... 直接采用紧凑 UTF-8 JSON，省去 Base64 33% 膨胀） */
  function buildSkeletonCode() {
    var sk = getStore().exportSkeleton ? getStore().exportSkeleton() : { v: 1, s: ['当前学期', '', 20], c: [] };
    return 'CPQR1:' + JSON.stringify(sk);
  }

  /** 解析极简课表骨架同步串（兼容直接 JSON 与 Base64 编码） */
  function parseSkeletonCode(code) {
    var s = String(code || '').trim();
    if (s.indexOf('CPQR1:') !== 0) throw new Error('不是有效的课表骨架二维码');
    var payload = s.slice(6).trim();
    if (payload.charAt(0) === '{') {
      return JSON.parse(payload);
    }
    var json = bytesToUtf8(b64ToBytes(payload));
    return JSON.parse(json);
  }

  /**
   * 将同步 JSON 压缩并切分为多帧二维码数组
   * 每帧格式: CPQRF:idx/total/hash:chunk (每帧 <= 420 字符，稳定落在 V11-V13 易扫区间)
   */
  function buildStreamFrames(scope) {
    var json = getStore().exportJSON(scope || 'standard');
    var chunkSize = 360;

    function slicePayload(prefix, b64) {
      var full = prefix + b64;
      var hash = calcHash(full);
      var frames = [];
      var total = Math.max(1, Math.ceil(full.length / chunkSize));
      for (var i = 0; i < total; i++) {
        var part = full.slice(i * chunkSize, (i + 1) * chunkSize);
        frames.push('CPQRF:' + (i + 1) + '/' + total + '/' + hash + ':' + part);
      }
      return { frames: frames, total: total, hash: hash, rawBytes: json.length, encodedLen: full.length };
    }

    if (typeof CompressionStream !== 'undefined' && typeof Response !== 'undefined') {
      try {
        var bytes = utf8ToBytes(json);
        var cs = new CompressionStream('gzip');
        var writer = cs.writable.getWriter();
        writer.write(bytes);
        writer.close();
        return new Response(cs.readable).arrayBuffer().then(function (buf) {
          var b64 = bytesToB64(new Uint8Array(buf));
          return slicePayload('G', b64);
        }).catch(function () {
          return slicePayload('R', bytesToB64(utf8ToBytes(json)));
        });
      } catch (e) {
        return Promise.resolve(slicePayload('R', bytesToB64(utf8ToBytes(json))));
      }
    }
    return Promise.resolve(slicePayload('R', bytesToB64(utf8ToBytes(json))));
  }

  /** 解析单帧 CPQRF:idx/total/hash:chunk */
  function parseStreamFrame(text) {
    var m = /^CPQRF:(\d+)\/(\d+)\/([0-9A-Fa-f]{4}):([\s\S]+)$/.exec(String(text || '').trim());
    if (!m) return null;
    return {
      index: parseInt(m[1], 10),
      total: parseInt(m[2], 10),
      hash: m[3].toUpperCase(),
      chunk: m[4]
    };
  }

  /** 集齐全部切片后重组并解压为原始同步 JSON 字符串 */
  function assembleStreamFrames(chunksMap, total, expectedHash) {
    var full = '';
    for (var i = 1; i <= total; i++) {
      if (!chunksMap[i]) return Promise.reject(new Error('缺少第 ' + i + ' 帧数据'));
      full += chunksMap[i];
    }
    if (expectedHash && calcHash(full) !== expectedHash.toUpperCase()) {
      return Promise.reject(new Error('二维码分片校验和不匹配，请重新扫描'));
    }
    var mode = full.charAt(0);
    var b64 = full.slice(1);
    var bytes = b64ToBytes(b64);
    if (mode === 'R') {
      return Promise.resolve(bytesToUtf8(bytes));
    }
    if (mode === 'G') {
      if (typeof DecompressionStream === 'undefined') {
        return Promise.reject(new Error('当前浏览器不支持 Gzip 解压'));
      }
      return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')))
        .arrayBuffer().then(function (buf) {
          return bytesToUtf8(new Uint8Array(buf));
        });
    }
    return Promise.reject(new Error('未知的二维码压缩格式'));
  }

  /* ==========================================================
   * 四、UI 弹窗：极简课表码 / 动态全量轮播码 / 扫码接收器
   * ========================================================== */
  function openDialog(initialTab) {
    var activeTab = initialTab || 'skeleton'; // 'skeleton' | 'stream' | 'scan'
    var playTimer = null;
    var camStream = null;
    var scanTimer = null;

    function stopTimersAndCam() {
      if (playTimer) { clearInterval(playTimer); playTimer = null; }
      if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
      if (camStream) {
        try { camStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
        camStream = null;
      }
    }

    var root = el('div', { class: 'qr-sync-modal' });
    var modalApi = V.modal({
      title: '📱 二维码面对面同步与课表分享',
      width: '560px',
      body: root,
      onClose: stopTimersAndCam,
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '关闭', onclick: function () { stopTimersAndCam(); modalApi.close(); } })
      ])
    });

    function render() {
      stopTimersAndCam();
      root.innerHTML = '';

      var tabBar = el('div', { class: 'pane-tabs', style: { marginBottom: '14px' } }, [
        el('button', {
          class: 'pane-tab' + (activeTab === 'skeleton' ? ' active' : ''),
          text: '📅 课表骨架单码',
          onclick: function () { activeTab = 'skeleton'; render(); }
        }),
        el('button', {
          class: 'pane-tab' + (activeTab === 'stream' ? ' active' : ''),
          text: '🎞️ 全量动态轮播码',
          onclick: function () { activeTab = 'stream'; render(); }
        }),
        el('button', {
          class: 'pane-tab' + (activeTab === 'scan' ? ' active' : ''),
          text: '📷 扫码/传图接收',
          onclick: function () { activeTab = 'scan'; render(); }
        })
      ]);
      root.appendChild(tabBar);

      if (activeTab === 'skeleton') renderSkeletonTab(root);
      else if (activeTab === 'stream') renderStreamTab(root);
      else renderScanTab(root);
    }

    /* ---------- Tab 1: 极简课表骨架单码 ---------- */
    function renderSkeletonTab(host) {
      var code = buildSkeletonCode();
      var sem = getStore().currentSemester ? getStore().currentSemester() : { name: '当前学期', weeks: 20 };
      var sid = getStore().semester ? getStore().semester.id : '';
      var courseCount = getStore().courses.filter(function (c) { return !c.semesterId || c.semesterId === sid; }).length;

      host.appendChild(el('p', {
        class: 'ocr-hint',
        style: { marginBottom: '12px', lineHeight: '1.6' },
        text: '将当前学期的课程表压缩为极简骨架数据（仅含课程、节次与实验轮转，不含私人待办/账本），一键生成课表分享名片或面对面扫码导入。'
      }));

      var qrBox = el('div', {
        class: 'card',
        style: { padding: '18px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', background: 'var(--surface-2)' }
      });

      var canvas = document.createElement('canvas');
      canvas.style.cssText = 'border-radius:10px;box-shadow:0 4px 14px rgba(0,0,0,0.08);max-width:100%;height:auto;background:#fff;';
      qrBox.appendChild(canvas);

      try {
        // 如果课表极简串在单码容量内（<= 850B），直接画单张静态码；若课程极多超出容量，自动分片轮播
        var byteLen = utf8ToBytes(code).length;
        if (byteLen <= 850) {
          var qrInfo = renderToCanvas(canvas, code, { size: 280, margin: 4 });
          qrBox.appendChild(el('div', {
            style: { fontSize: '12.5px', color: 'var(--text-2)', fontWeight: '600' },
            text: sem.name + ' · 共 ' + courseCount + ' 门课程（单码 ' + byteLen + ' B · QR v' + qrInfo.version + '）'
          }));
        } else {
          // 超大课表自动以轮播分片呈现
          var chunkSz = 420;
          var hash = calcHash('R' + bytesToB64(utf8ToBytes(JSON.stringify(getStore().exportSkeleton()))));
          var fullStr = 'R' + bytesToB64(utf8ToBytes(JSON.stringify(getStore().exportSkeleton())));
          var totalF = Math.ceil(fullStr.length / chunkSz);
          var curF = 0;
          var fLabel = el('div', { style: { fontSize: '12.5px', fontWeight: '600', color: 'var(--primary)' } });
          function drawSkFrame() {
            var part = fullStr.slice(curF * chunkSz, (curF + 1) * chunkSz);
            var fText = 'CPQRF:' + (curF + 1) + '/' + totalF + '/' + hash + ':' + part;
            renderToCanvas(canvas, fText, { size: 280, margin: 4 });
            fLabel.textContent = sem.name + ' · 课程较多已启用轮播（第 ' + (curF + 1) + '/' + totalF + ' 帧）';
            curF = (curF + 1) % totalF;
          }
          drawSkFrame();
          playTimer = setInterval(drawSkFrame, 250);
          qrBox.appendChild(fLabel);
        }
      } catch (e) {
        qrBox.appendChild(el('div', { style: { color: 'var(--red)', fontSize: '13px' }, text: e.message }));
      }

      host.appendChild(qrBox);

      // 操作按钮：保存高清分享名片 PNG + 复制分享码
      host.appendChild(el('div', { style: { display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '14px', flexWrap: 'wrap' } }, [
        el('button', {
          class: 'btn btn-primary',
          onclick: function () {
            exportScheduleQrCard(canvas, sem.name || '当前学期', courseCount);
          }
        }, ['💾 保存课表二维码名片 (PNG)']),
        el('button', {
          class: 'btn',
          onclick: function () {
            if (global.SaveFile && SaveFile.copyText) {
              SaveFile.copyText(code).then(function (ok) {
                getUI().toast(ok ? '已复制课表分享码，可在「扫码/传图接收」直接粘贴' : '复制失败', ok ? 'ok' : 'err');
              });
            }
          }
        }, ['📋 复制课表分享码'])
      ]));
    }

    /* ---------- Tab 2: 动态切片轮播码（全量离线迁移） ---------- */
    function renderStreamTab(host) {
      var scope = 'standard';
      var fps = 5;
      var playing = true;
      var curIdx = 0;
      var frames = [];

      host.appendChild(el('p', {
        class: 'ocr-hint',
        style: { marginBottom: '10px', lineHeight: '1.6' },
        text: '将全量数据（课程、待办、计划、记账、成绩、设置）经 Gzip 压缩后切分为动态二维码轮播。另一台设备打开「扫码/传图接收」对准屏幕即可自动收集全部帧并完成离线迁移。'
      }));

      var ctrlTop = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' } });
      var scopeSeg = V.segment([
        { value: 'standard', label: '标准全量同步' },
        { value: 'lite', label: '仅课表与设置' }
      ], scope, function (v) {
        scope = v;
        rebuildFrames();
      });
      var fpsSeg = V.segment([
        { value: '3', label: '慢速 3帧/s' },
        { value: '5', label: '标准 5帧/s' },
        { value: '8', label: '高速 8帧/s' }
      ], String(fps), function (v) {
        fps = parseInt(v, 10) || 5;
        restartLoop();
      });
      ctrlTop.appendChild(scopeSeg);
      ctrlTop.appendChild(fpsSeg);
      host.appendChild(ctrlTop);

      var stageBox = el('div', {
        class: 'card',
        style: { padding: '16px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', background: 'var(--surface-2)' }
      });
      var canvas = document.createElement('canvas');
      canvas.style.cssText = 'border-radius:10px;box-shadow:0 4px 14px rgba(0,0,0,0.08);max-width:100%;height:auto;background:#fff;';
      var progressInfo = el('div', { style: { fontSize: '13px', fontWeight: '600', color: 'var(--primary)' }, text: '正在压缩并生成分片…' });
      var framePills = el('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'center', maxWidth: '380px' } });

      stageBox.appendChild(canvas);
      stageBox.appendChild(progressInfo);
      stageBox.appendChild(framePills);

      var btnPlay = el('button', {
        class: 'btn btn-sm',
        text: '⏸ 暂停轮播',
        onclick: function () {
          playing = !playing;
          btnPlay.textContent = playing ? '⏸ 暂停轮播' : '▶️ 继续轮播';
          restartLoop();
        }
      });
      var stepRow = el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, [
        el('button', {
          class: 'btn btn-sm', text: '⏮ 上一帧',
          onclick: function () {
            if (!frames.length) return;
            playing = false;
            btnPlay.textContent = '▶️ 继续轮播';
            restartLoop();
            curIdx = (curIdx - 1 + frames.length) % frames.length;
            paintFrame();
          }
        }),
        btnPlay,
        el('button', {
          class: 'btn btn-sm', text: '⏭ 下一帧',
          onclick: function () {
            if (!frames.length) return;
            playing = false;
            btnPlay.textContent = '▶️ 继续轮播';
            restartLoop();
            curIdx = (curIdx + 1) % frames.length;
            paintFrame();
          }
        })
      ]);
      stageBox.appendChild(stepRow);
      host.appendChild(stageBox);

      function paintFrame() {
        if (!frames.length) return;
        renderToCanvas(canvas, frames[curIdx], { size: 280, margin: 4 });
        progressInfo.textContent = '正在轮播：第 ' + (curIdx + 1) + ' / ' + frames.length + ' 帧（点击下方帧号可定点补扫）';
        Array.prototype.forEach.call(framePills.children, function (pill, idx) {
          pill.style.background = idx === curIdx ? 'var(--primary)' : 'var(--surface)';
          pill.style.color = idx === curIdx ? '#fff' : 'var(--text-2)';
        });
      }

      function restartLoop() {
        if (playTimer) { clearInterval(playTimer); playTimer = null; }
        if (playing && frames.length > 1) {
          playTimer = setInterval(function () {
            curIdx = (curIdx + 1) % frames.length;
            paintFrame();
          }, Math.round(1000 / fps));
        }
      }

      function rebuildFrames() {
        if (playTimer) { clearInterval(playTimer); playTimer = null; }
        buildStreamFrames(scope).then(function (res) {
          frames = res.frames || [];
          curIdx = 0;
          framePills.innerHTML = '';
          frames.forEach(function (_, idx) {
            framePills.appendChild(el('button', {
              class: 'chip',
              style: { cursor: 'pointer', fontSize: '11px', padding: '2px 7px', border: '1px solid var(--line)' },
              text: String(idx + 1),
              onclick: function () {
                playing = false;
                btnPlay.textContent = '▶️ 继续轮播';
                restartLoop();
                curIdx = idx;
                paintFrame();
              }
            }));
          });
          paintFrame();
          restartLoop();
        });
      }

      rebuildFrames();
    }

    /* ---------- Tab 3: 扫码 / 传图 / 粘贴接收 ---------- */
    function renderScanTab(host) {
      var collector = { total: 0, hash: '', chunks: {}, count: 0 };

      host.appendChild(el('p', {
        class: 'ocr-hint',
        style: { marginBottom: '10px', lineHeight: '1.6' },
        text: '支持开启摄像头对准另一台设备的「单张课表码」或「动态轮播码」，也支持直接从相册选择保存的二维码名片图片。'
      }));

      var videoWrap = el('div', {
        class: 'card',
        style: { padding: '14px', textAlign: 'center', background: 'var(--surface-2)', marginBottom: '12px' }
      });
      var video = el('video', {
        autoplay: 'autoplay', muted: 'muted', playsinline: 'playsinline',
        style: { width: '100%', maxWidth: '320px', borderRadius: '10px', display: 'none', margin: '0 auto 10px', background: '#000' }
      });
      var statusText = el('div', { style: { fontSize: '13px', fontWeight: '600', color: 'var(--text-2)', marginBottom: '8px' }, text: '请选择下方扫码方式或上传二维码图片' });
      var progressWrap = el('div', { style: { display: 'none', marginBottom: '10px' } });
      var progBarInner = el('div', { style: { width: '0%', height: '100%', background: 'var(--green)', transition: 'width .2s' } });
      var progBar = el('div', { style: { height: '8px', background: 'var(--line)', borderRadius: '4px', overflow: 'hidden', marginBottom: '8px' } }, [progBarInner]);
      var progSlots = el('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'center' } });
      progressWrap.appendChild(progBar);
      progressWrap.appendChild(progSlots);

      videoWrap.appendChild(video);
      videoWrap.appendChild(statusText);
      videoWrap.appendChild(progressWrap);

      var fileInput = el('input', {
        type: 'file', accept: 'image/*', multiple: 'multiple',
        style: { display: 'none' },
        onchange: function () {
          var files = Array.prototype.slice.call(fileInput.files || []);
          if (!files.length) return;
          processImageFiles(files);
        }
      });

      var btnCam = el('button', {
        class: 'btn btn-primary',
        onclick: function () {
          if (camStream) {
            stopTimersAndCam();
            video.style.display = 'none';
            btnCam.textContent = '📷 开启摄像头扫码';
            statusText.textContent = '已停止摄像头扫码';
            return;
          }
          startCamera();
        }
      }, ['📷 开启摄像头扫码']);

      var btnRow = el('div', { style: { display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' } }, [
        btnCam,
        el('button', {
          class: 'btn',
          onclick: function () { fileInput.click(); }
        }, ['🖼️ 选择二维码图片识别']),
        fileInput
      ]);
      videoWrap.appendChild(btnRow);
      host.appendChild(videoWrap);

      // 文本/分享码兜底输入框
      var pasteInp = V.textarea({
        rows: 3,
        placeholder: '或者在此粘贴「CPQR1:...」课表分享码 / 同步 JSON 文本…',
        style: { fontSize: '12px' }
      });
      host.appendChild(el('div', { class: 'card', style: { padding: '12px 14px' } }, [
        el('div', { style: { fontSize: '12.5px', fontWeight: '600', marginBottom: '6px' }, text: '文本分享码直通车（无摄像头时可用）' }),
        pasteInp,
        el('div', { style: { marginTop: '8px', display: 'flex', justifyContent: 'flex-end' } }, [
          el('button', {
            class: 'btn btn-sm btn-primary',
            onclick: function () {
              var val = (pasteInp.value || '').trim();
              if (!val) { getUI().toast('请先粘贴分享码内容', 'err'); return; }
              onDecodedText(val);
            }
          }, ['解析并导入'])
        ])
      ]));

      function updateCollectorUI() {
        if (!collector.total) return;
        progressWrap.style.display = 'block';
        var pct = Math.round((collector.count / collector.total) * 100);
        progBarInner.style.width = pct + '%';
        statusText.textContent = '动态多帧接收中：已捕获 ' + collector.count + ' / ' + collector.total + ' 帧 (' + pct + '%)';
        progSlots.innerHTML = '';
        var missing = [];
        for (var i = 1; i <= collector.total; i++) {
          var got = !!collector.chunks[i];
          if (!got) missing.push(i);
          progSlots.appendChild(el('span', {
            class: 'chip',
            style: {
              fontSize: '11px',
              padding: '1px 6px',
              background: got ? 'var(--green)' : 'var(--surface)',
              color: got ? '#fff' : 'var(--text-3)',
              border: '1px solid ' + (got ? 'var(--green)' : 'var(--line)')
            },
            text: (got ? '✓ ' : '') + i
          }));
        }
        if (missing.length && missing.length <= 4) {
          statusText.textContent += ' · 还差第 ' + missing.join('、') + ' 帧（可在发送端点击对应帧号定点补扫）';
        }
      }

      function onDecodedText(raw) {
        var s = String(raw || '').trim();
        if (!s) return;

        // 1. 极简课表骨架单码
        if (s.indexOf('CPQR1:') === 0) {
          stopTimersAndCam();
          try {
            var skObj = parseSkeletonCode(s);
            promptImportSkeleton(skObj, modalApi);
          } catch (e) {
            getUI().toast('二维码解析失败：' + e.message, 'err');
          }
          return;
        }

        // 2. 动态分片轮播帧
        if (s.indexOf('CPQRF:') === 0) {
          var f = parseStreamFrame(s);
          if (!f) return;
          if (collector.hash !== f.hash || collector.total !== f.total) {
            collector.hash = f.hash;
            collector.total = f.total;
            collector.chunks = {};
            collector.count = 0;
          }
          if (!collector.chunks[f.index]) {
            collector.chunks[f.index] = f.chunk;
            collector.count++;
            if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }
            updateCollectorUI();
          }
          if (collector.count >= collector.total) {
            stopTimersAndCam();
            statusText.textContent = '🎉 已集齐全部 ' + collector.total + ' 帧，正在解压校验…';
            assembleStreamFrames(collector.chunks, collector.total, collector.hash).then(function (jsonStr) {
              var parsed = JSON.parse(jsonStr);
              // 判断是骨架还是全量同步备份
              if (parsed && parsed.v === 1 && Array.isArray(parsed.c) && !parsed.courses) {
                promptImportSkeleton(parsed, modalApi);
              } else {
                promptImportFullSync(jsonStr, modalApi);
              }
            }).catch(function (err) {
              getUI().toast('分片重组失败：' + err.message, 'err');
            });
          }
          return;
        }

        // 3. 直接是全量 JSON
        if (s.charAt(0) === '{') {
          stopTimersAndCam();
          promptImportFullSync(s, modalApi);
        }
      }

      function startCamera() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          getUI().toast('当前环境不支持直接调起摄像头，请使用「选择二维码图片识别」或粘贴分享码', 'err');
          return;
        }
        statusText.textContent = '正在请求摄像头权限…';
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 720 }, height: { ideal: 720 } }
        }).then(function (stream) {
          camStream = stream;
          video.srcObject = stream;
          video.style.display = 'block';
          btnCam.textContent = '⏹ 停止摄像头';
          statusText.textContent = '请将二维码对准取景框…';

          var capCanvas = document.createElement('canvas');
          var capCtx = capCanvas.getContext('2d', { willReadFrequently: true });
          scanTimer = setInterval(function () {
            if (!video.videoWidth || !video.videoHeight) return;
            capCanvas.width = video.videoWidth;
            capCanvas.height = video.videoHeight;
            capCtx.drawImage(video, 0, 0);
            detectQrFromSource(capCanvas).then(function (txt) {
              if (txt) onDecodedText(txt);
            });
          }, 120);
        }).catch(function (err) {
          statusText.textContent = '无法打开摄像头：' + (err && err.message ? err.message : '权限被拒绝');
        });
      }

      function processImageFiles(files) {
        statusText.textContent = '正在识别图片中的二维码…';
        var idx = 0;
        var foundAny = false;
        function nextFile() {
          if (idx >= files.length) {
            if (!foundAny) getUI().toast('未在图片中识别到有效课表二维码，请确保二维码清晰完整', 'err');
            return;
          }
          var file = files[idx++];
          var img = new Image();
          var url = URL.createObjectURL(file);
          img.onload = function () {
            URL.revokeObjectURL(url);
            var c = document.createElement('canvas');
            c.width = img.width;
            c.height = img.height;
            c.getContext('2d').drawImage(img, 0, 0);
            detectQrFromSource(c).then(function (txt) {
              if (txt) {
                foundAny = true;
                onDecodedText(txt);
              }
              nextFile();
            });
          };
          img.onerror = function () {
            URL.revokeObjectURL(url);
            nextFile();
          };
          img.src = url;
        }
        nextFile();
      }
    }

    render();
  }

  /** 导出带标题与说明的课表二维码名片 PNG */
  function exportScheduleQrCard(qrCanvas, semName, courseCount) {
    var W = 520, H = 640;
    var out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    var ctx = out.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, W, H);

    var grad = ctx.createLinearGradient(0, 0, W, 130);
    grad.addColorStop(0, '#4f46e5');
    grad.addColorStop(1, '#2563eb');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, 130);

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '13px sans-serif';
    ctx.fillText('COURSE PLANNER · 极简课表骨架同步码', 32, 42);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText(semName + ' · 课程表名片', 32, 82);

    ctx.font = '14px sans-serif';
    ctx.fillText('共包含 ' + courseCount + ' 门课程及作息时间安排', 32, 110);

    // 居中绘制二维码（保留原始像素区域以便相册直接识别）
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(40, 155, 440, 410);
    var qrSize = 340;
    var qx = Math.round((W - qrSize) / 2);
    var qy = 175;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(qrCanvas, qx, qy, qrSize, qrSize);

    ctx.fillStyle = '#64748b';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('打开「课程规划助手 → 二维码分享 → 扫码/传图接收」即可一键导入', W / 2, 545);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px sans-serif';
    ctx.fillText('纯本地离线编码 · 零服务器上传', W / 2, 605);

    out.toBlob(function (blob) {
      if (!blob) return;
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = '课表二维码名片-' + semName + '.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      getUI().toast('已保存课表二维码名片！');
    }, 'image/png');
  }

  /** 询问并执行极简课表骨架导入 */
  function promptImportSkeleton(skObj, parentModal) {
    var cLen = (skObj && Array.isArray(skObj.c)) ? skObj.c.length : 0;
    var sName = (skObj && skObj.s && skObj.s[0]) ? skObj.s[0] : '当前学期';
    var m = V.modal({
      title: '识别到课表二维码',
      width: '440px',
      body: [
        el('div', { class: 'preview-box', style: { marginBottom: '12px' } }, [
          el('b', { style: { fontSize: '15px' }, text: '📅 ' + sName }),
          el('div', { style: { marginTop: '6px', fontSize: '13px', color: 'var(--text-2)' }, text: '共识别到 ' + cLen + ' 门课程安排（含上课节次、地点与实验轮转规则）。' })
        ]),
        el('p', { class: 'ocr-hint', text: '请选择导入方式：「合并追加」会把新课程加入当前学期；「覆盖当前学期」会替换当前学期的原有课程。' })
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } }),
        el('button', {
          class: 'btn',
          text: '覆盖当前学期课程',
          onclick: function () {
            getStore().backupNow('二维码课表覆盖前').then(function () {
              var r = getStore().importSkeleton(skObj, 'replace');
              m.close();
              if (parentModal) parentModal.close();
              getUI().toast('已覆盖导入 ' + r.added + ' 门课程');
              if (global.App) App.go('schedule');
            });
          }
        }),
        el('button', {
          class: 'btn btn-primary',
          text: '合并追加到当前课表',
          onclick: function () {
            var r = getStore().importSkeleton(skObj, 'merge');
            m.close();
            if (parentModal) parentModal.close();
            getUI().toast('已追加导入 ' + r.added + ' 门课程');
            if (global.App) App.go('schedule');
          }
        })
      ])
    });
  }

  /** 询问并执行全量数据同步覆盖 */
  function promptImportFullSync(jsonStr, parentModal) {
    var d;
    try { d = getStore().diffImport(jsonStr); } catch (e) { getUI().toast('同步内容不是有效的备份：' + e.message, 'err'); return; }
    var msg = d.empty
      ? '⚠️ 收到的同步内容几乎是空的，覆盖后本机会被清空。覆盖前会自动备份，可以回滚。'
      : (d.wipes.length
          ? '⚠️ 有 ' + d.wipes.length + ' 类数据会被清空（' +
            d.wipes.map(function (w) { return w.name; }).join('、') + '）。覆盖前会自动备份，可以回滚。'
          : '已完整接收同步数据，覆盖前会自动备份当前数据，可以回滚。');
    V.confirm({
      title: '扫码全量同步 · 对比',
      message: msg,
      body: V.diffPanel(d),
      danger: true,
      okText: '确认覆盖同步'
    }).then(function (ok) {
      if (!ok) return;
      getStore().backupNow('二维码同步覆盖前').then(function () {
        try {
          getStore().importJSON(jsonStr);
          if (parentModal) parentModal.close();
          getUI().toast('二维码同步完成（原数据已自动备份）');
          if (global.App) App.go('schedule');
        } catch (err) {
          getUI().toast('同步失败：' + err.message, 'err');
        }
      });
    });
  }


  /* ==========================================================
   * 五、WebDAV 无后端跨端云同步 (支持坚果云 / Nextcloud / Alist / CORS 代理)
   * ========================================================== */
  var WEBDAV_KEY = 'cp-webdav-config:v1';

  function loadWebdavConfig() {
    var def = {
      url: '',
      username: '',
      password: '',
      filename: 'course-planner-sync.json',
      scope: 'standard',
      corsProxy: ''
    };
    try {
      if (typeof localStorage !== 'undefined') {
        var raw = localStorage.getItem(WEBDAV_KEY);
        if (raw) {
          var obj = JSON.parse(raw);
          return Object.assign(def, obj || {});
        }
      }
    } catch (_) {}
    return def;
  }

  function saveWebdavConfig(cfg) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(WEBDAV_KEY, JSON.stringify(cfg || {}));
      }
    } catch (_) {}
  }

  function buildWebdavTargetUrl(cfg) {
    var base = String((cfg && cfg.url) || '').trim();
    if (!base) throw new Error('请填写 WebDAV 服务器目录地址');
    if (base.charAt(base.length - 1) !== '/') base += '/';
    var fn = String((cfg && cfg.filename) || 'course-planner-sync.json').trim().replace(/^\/+/, '');
    if (!fn) fn = 'course-planner-sync.json';
    var full = base + fn;
    var proxy = String((cfg && cfg.corsProxy) || '').trim();
    if (proxy) {
      if (proxy.indexOf('{url}') >= 0) return proxy.replace('{url}', encodeURIComponent(full));
      if (proxy.charAt(proxy.length - 1) !== '/') proxy += '/';
      return proxy + full;
    }
    return full;
  }

  function buildWebdavAuthHeader(cfg) {
    var u = String((cfg && cfg.username) || '').trim();
    var p = String((cfg && cfg.password) || '').trim();
    if (!u && !p) return '';
    var raw = u + ':' + p;
    var bytes = utf8ToBytes(raw);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return 'Basic ' + btoa(bin);
  }

  function openWebdavDialog() {
    var V = getUI();
    var el = V.el;
    var Store = getStore();
    var cfg = loadWebdavConfig();

    var fUrl = V.input({
      placeholder: '例如：https://dav.jianguoyun.com/dav/我的课表/',
      value: cfg.url || ''
    });
    var fUser = V.input({
      placeholder: '网盘账号 / 邮箱',
      value: cfg.username || ''
    });
    var fPass = V.input({
      type: 'password',
      placeholder: '应用专用密码（非登录密码）',
      value: cfg.password || ''
    });
    var fFile = V.input({
      placeholder: 'course-planner-sync.json',
      value: cfg.filename || 'course-planner-sync.json'
    });
    var fProxy = V.input({
      placeholder: '选填：若网盘拦截浏览器跨域(CORS)，可填反代前缀',
      value: cfg.corsProxy || ''
    });

    var scopeVal = cfg.scope || 'standard';
    var fScope = V.segment([
      { value: 'standard', label: '标准同步（不含图片与密钥）' },
      { value: 'full', label: '完整备份（含日记正文）' }
    ], scopeVal, function (v) { scopeVal = v; });

    var statusEl = el('div', {
      style: { fontSize: '12px', color: 'var(--text-2)', padding: '8px 10px', borderRadius: '8px', background: 'var(--surface-2)', marginTop: '8px' },
      text: '💡 提示：WebDAV 配置仅保存在当前设备本地，导出同步码时不会外泄。若使用坚果云等不支持浏览器直接跨域(CORS)的网盘，推荐配合 Alist 或在安卓端 WebView 内使用。'
    });

    function collectCfg() {
      var next = {
        url: fUrl.value.trim(),
        username: fUser.value.trim(),
        password: fPass.value.trim(),
        filename: fFile.value.trim() || 'course-planner-sync.json',
        scope: scopeVal,
        corsProxy: fProxy.value.trim()
      };
      saveWebdavConfig(next);
      return next;
    }

    var body = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
      el('div', { style: { fontSize: '12.5px', color: 'var(--text-2)', lineHeight: '1.6' } }, [
        '通过标准 WebDAV 协议（HTTP PUT / GET），无需自建后端服务器即可将课表与待办加密同步到你自己的私有云盘（如 Nextcloud、Alist、自建 WebDAV 或坚果云）。'
      ]),
      V.field('服务器目录地址 (URL)', fUrl),
      el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } }, [
        V.field('账号 (Username)', fUser),
        V.field('应用密码 (App Password)', fPass)
      ]),
      el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } }, [
        V.field('云端文件名', fFile),
        V.field('CORS 跨域代理（选填）', fProxy)
      ]),
      V.field('同步内容范围', fScope),
      statusEl,
      el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px' } }, [
        el('button', {
          class: 'btn btn-primary',
          onclick: function () {
            var c;
            try { c = collectCfg(); } catch (e) { V.toast(e.message, 'err'); return; }
            var target;
            try { target = buildWebdavTargetUrl(c); } catch (e) { V.toast(e.message, 'err'); return; }
            var payload = Store.exportJSON ? Store.exportJSON(c.scope || 'standard') : '{}';
            statusEl.textContent = '⏳ 正在上传至 WebDAV 云端…';
            var headers = { 'Content-Type': 'application/json; charset=utf-8' };
            var auth = buildWebdavAuthHeader(c);
            if (auth) headers['Authorization'] = auth;
            fetch(target, { method: 'PUT', headers: headers, body: payload }).then(function (res) {
              if (res.ok || res.status === 201 || res.status === 204) {
                statusEl.textContent = '✅ 上传成功！已同步至 ' + c.filename + '（' + Math.round(payload.length / 1024 * 10) / 10 + ' KB）';
                V.toast('WebDAV 云端上传成功');
              } else {
                statusEl.textContent = '❌ 上传失败：HTTP ' + res.status + '（请检查目录是否存在及账号密码权限）';
                V.toast('上传失败：HTTP ' + res.status, 'err');
              }
            }).catch(function (err) {
              statusEl.textContent = '❌ 网络或跨域(CORS)拦截：' + (err && err.message ? err.message : '请求失败') + '。若在纯网页端直连坚果云，需配置 CORS 代理或在 Alist/Nextcloud 中开启跨域。';
              V.toast('请求被拦截，请查看下方提示', 'err');
            });
          }
        }, ['⬆️ 上传到云端 (PUT)']),
        el('button', {
          class: 'btn',
          onclick: function () {
            var c;
            try { c = collectCfg(); } catch (e) { V.toast(e.message, 'err'); return; }
            var target;
            try { target = buildWebdavTargetUrl(c); } catch (e) { V.toast(e.message, 'err'); return; }
            statusEl.textContent = '⏳ 正在从 WebDAV 云端拉取…';
            var headers = {};
            var auth = buildWebdavAuthHeader(c);
            if (auth) headers['Authorization'] = auth;
            fetch(target, { method: 'GET', headers: headers }).then(function (res) {
              if (!res.ok) throw new Error('HTTP ' + res.status);
              return res.text();
            }).then(function (text) {
              // 以前这里是「拉到就直接覆盖」，连问都不问——云端文件可能是另一台设备
              // 很久以前的旧版本，一键下去本机的新数据就没了。现在先摆对比再确认。
              statusEl.textContent = '';
              var d;
              try { d = Store.diffImport(text); } catch (e) { throw new Error('云端文件不是有效的备份：' + e.message); }
              var msg = d.empty
                ? '⚠️ 云端那份几乎是空的，恢复后本机会被清空。恢复前会自动备份，可以回滚。'
                : (d.wipes.length
                    ? '⚠️ 有 ' + d.wipes.length + ' 类数据会被清空（' +
                      d.wipes.map(function (w) { return w.name; }).join('、') + '）。恢复前会自动备份，可以回滚。'
                    : '恢复前会自动备份当前数据，可以回滚。');
              return V.confirm({
                title: '从云端恢复 · 对比',
                message: msg,
                body: V.diffPanel(d),
                danger: true, okText: '覆盖恢复'
              }).then(function (ok) {
                if (!ok) {
                  statusEl.textContent = '已取消，本机数据没有改动';
                  return;
                }
                var bkPromise = Store.backupNow ? Store.backupNow('WebDAV同步覆盖前') : Promise.resolve();
                return bkPromise.then(function () {
                  Store.importJSON(text);
                  statusEl.textContent = '✅ 已从云端拉取并恢复数据（原本地数据已自动备份）';
                  V.toast('WebDAV 云端同步完成');
                });
              });
            }).catch(function (err) {
              statusEl.textContent = '❌ 拉取失败：' + (err && err.message ? err.message : '请求失败');
              V.toast('拉取失败：' + (err && err.message ? err.message : ''), 'err');
            });
          }
        }, ['⬇️ 从云端拉取恢复 (GET)']),
        el('button', {
          class: 'btn',
          onclick: function () {
            collectCfg();
            V.toast('已保存 WebDAV 配置');
          }
        }, ['保存配置'])
      ])
    ]);

    var api = V.modal({
      title: '☁️ WebDAV 无后端云同步',
      width: '560px',
      body: body,
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '关闭', onclick: function () { api.close(); } })
      ])
    });
  }

  global.QrSync = {
    encodeMatrix: encodeMatrix,
    decodeFromMatrix: decodeFromMatrix,
    decodeFromCanvas: decodeFromCanvas,
    renderToCanvas: renderToCanvas,
    buildSkeletonCode: buildSkeletonCode,
    parseSkeletonCode: parseSkeletonCode,
    buildStreamFrames: buildStreamFrames,
    parseStreamFrame: parseStreamFrame,
    assembleStreamFrames: assembleStreamFrames,
    openDialog: openDialog,
    openWebdavDialog: openWebdavDialog,
    buildWebdavTargetUrl: buildWebdavTargetUrl,
    buildWebdavAuthHeader: buildWebdavAuthHeader
  };
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
