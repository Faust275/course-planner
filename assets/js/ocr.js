

/* ==========================================================
 * 图片识别课表
 *  1) 本地 OCR：Tesseract.js（按需从 CDN 加载，不占首屏体积）
 *  2) 云端兜底：OpenAI 兼容的视觉接口（自带 Key）
 *  3) 表格还原：按表头/几何位置把词归到「星期 × 节次」网格
 * ========================================================== */
(function (global) {
  'use strict';

  var TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';
  var WORKER = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js';
  var CORE = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0';
  // 该目录下就是 chi_sim.traineddata.gz（直接指向具体版本，避免 404）
  var LANG = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/chi_sim@1.0.0/4.0.0_best_int';

  var libPromise = null;

  function loadLib() {
    if (global.Tesseract) return Promise.resolve(global.Tesseract);
    if (libPromise) return libPromise;
    libPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = TESS;
      s.onload = function () { resolve(global.Tesseract); };
      s.onerror = function () {
        libPromise = null;
        reject(new Error('OCR 组件下载失败，请检查网络后重试'));
      };
      document.head.appendChild(s);
    });
    return libPromise;
  }

  /** 把图片缩放到合适尺寸（太小的放大，太大的缩小），返回 canvas */
  function normalizeImage(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var w = img.width, h = img.height;
        var scale = 1;
        if (w < 1400) scale = Math.min(3, 1400 / w);  // 小图放大，字太小认不出来
        else if (w > 2400) scale = 2400 / w;          // 超大图缩小，识别太慢
        var W = Math.round(w * scale), H = Math.round(h * scale);
        var c = document.createElement('canvas');
        c.width = W; c.height = H;
        var ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, W, H);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, W, H);
        URL.revokeObjectURL(url);
        c.toBlob(function (blob) {
          resolve({ blob: blob, canvas: c, width: W, height: H });
        }, 'image/png');
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
      img.src = url;
    });
  }

  /** 旋转 Canvas（支持 90 / -90 / 180 度，用于修正横拍照片） */
  function rotateCanvas(srcCanvas, deg) {
    var d = ((deg % 360) + 360) % 360;
    if (d === 0) return srcCanvas;
    var sw = srcCanvas.width, sh = srcCanvas.height;
    var dst = document.createElement('canvas');
    dst.width = (d === 90 || d === 270) ? sh : sw;
    dst.height = (d === 90 || d === 270) ? sw : sh;
    var ctx = dst.getContext('2d', { willReadFrequently: true });
    ctx.save();
    ctx.translate(dst.width / 2, dst.height / 2);
    ctx.rotate(d * Math.PI / 180);
    ctx.drawImage(srcCanvas, -sw / 2, -sh / 2);
    ctx.restore();
    return dst;
  }

  /**
   * 求解 4 点透视单应性矩阵 H (3x3，满足 H[8]=1)：将目标矩形 (u,v) 逆映射到源图四边形 (x,y)
   * dstPts: [[0,0],[W,0],[W,H],[0,H]], srcPts: [[x0,y0],[x1,y1],[x2,y2],[x3,y3]]
   */
  function solveHomography(dstPts, srcPts) {
    var A = [];
    var B = [];
    for (var i = 0; i < 4; i++) {
      var u = dstPts[i][0], v = dstPts[i][1];
      var x = srcPts[i][0], y = srcPts[i][1];
      A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
      B.push(x);
      A.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
      B.push(y);
    }
    // 高斯消元（列主元）求解 8x8 线性方程组
    var n = 8;
    for (var col = 0; col < n; col++) {
      var maxRow = col;
      var maxVal = Math.abs(A[col][col]);
      for (var r = col + 1; r < n; r++) {
        if (Math.abs(A[r][col]) > maxVal) {
          maxVal = Math.abs(A[r][col]);
          maxRow = r;
        }
      }
      if (maxVal < 1e-10) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
      var tmpRow = A[col]; A[col] = A[maxRow]; A[maxRow] = tmpRow;
      var tmpB = B[col]; B[col] = B[maxRow]; B[maxRow] = tmpB;

      var pivot = A[col][col];
      for (var j = col; j < n; j++) A[col][j] /= pivot;
      B[col] /= pivot;

      for (var r2 = 0; r2 < n; r2++) {
        if (r2 === col) continue;
        var factor = A[r2][col];
        if (factor === 0) continue;
        for (var j2 = col; j2 < n; j2++) A[r2][j2] -= factor * A[col][j2];
        B[r2] -= factor * B[col];
      }
    }
    return [B[0], B[1], B[2], B[3], B[4], B[5], B[6], B[7], 1];
  }

  /**
   * 四角透视矫正拉直（Perspective Rectification）
   * @param {HTMLCanvasElement} srcCanvas 原始画布
   * @param {Array<{x:number, y:number}>} corners 四个角点 [左上, 右上, 右下, 左下]（像素坐标或 0..1 归一化坐标）
   * @param {number} [outW] 输出宽度
   * @param {number} [outH] 输出高度
   */
  function warpPerspective(srcCanvas, corners, outW, outH) {
    if (!srcCanvas || !corners || corners.length !== 4) return srcCanvas;
    var sw = srcCanvas.width, sh = srcCanvas.height;
    var pts = corners.map(function (c) {
      var x = Array.isArray(c) ? c[0] : c.x;
      var y = Array.isArray(c) ? c[1] : c.y;
      if (x <= 1.0 && y <= 1.0 && (sw > 2 && sh > 2)) {
        return [x * sw, y * sh];
      }
      return [x, y];
    });

    var topW = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
    var botW = Math.hypot(pts[2][0] - pts[3][0], pts[2][1] - pts[3][1]);
    var leftH = Math.hypot(pts[3][0] - pts[0][0], pts[3][1] - pts[0][1]);
    var rightH = Math.hypot(pts[2][0] - pts[1][0], pts[2][1] - pts[1][1]);

    var W = Math.max(64, Math.round(outW || Math.max(topW, botW)));
    var H = Math.max(64, Math.round(outH || Math.max(leftH, rightH)));

    var Hmat = solveHomography([[0, 0], [W, 0], [W, H], [0, H]], pts);
    var dstCanvas = document.createElement('canvas');
    dstCanvas.width = W;
    dstCanvas.height = H;
    var sCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
    var dCtx = dstCanvas.getContext('2d', { willReadFrequently: true });
    if (!sCtx || !dCtx) return srcCanvas;

    var sImg = sCtx.getImageData(0, 0, sw, sh);
    var sData = sImg.data;
    var dImg = dCtx.createImageData(W, H);
    var dData = dImg.data;

    var h0 = Hmat[0], h1 = Hmat[1], h2 = Hmat[2],
        h3 = Hmat[3], h4 = Hmat[4], h5 = Hmat[5],
        h6 = Hmat[6], h7 = Hmat[7];

    for (var v = 0; v < H; v++) {
      for (var u = 0; u < W; u++) {
        var denom = h6 * u + h7 * v + 1;
        if (Math.abs(denom) < 1e-8) continue;
        var sx = (h0 * u + h1 * v + h2) / denom;
        var sy = (h3 * u + h4 * v + h5) / denom;
        var dstIdx = (v * W + u) * 4;
        if (sx < 0 || sx >= sw - 1 || sy < 0 || sy >= sh - 1) {
          dData[dstIdx] = dData[dstIdx + 1] = dData[dstIdx + 2] = 255;
          dData[dstIdx + 3] = 255;
          continue;
        }
        var x0 = sx | 0, y0 = sy | 0;
        var dx = sx - x0, dy = sy - y0;
        var w00 = (1 - dx) * (1 - dy),
            w10 = dx * (1 - dy),
            w01 = (1 - dx) * dy,
            w11 = dx * dy;
        var i00 = (y0 * sw + x0) * 4,
            i10 = i00 + 4,
            i01 = i00 + sw * 4,
            i11 = i01 + 4;
        dData[dstIdx]     = (sData[i00] * w00 + sData[i10] * w10 + sData[i01] * w01 + sData[i11] * w11) | 0;
        dData[dstIdx + 1] = (sData[i00 + 1] * w00 + sData[i10 + 1] * w10 + sData[i01 + 1] * w01 + sData[i11 + 1] * w11) | 0;
        dData[dstIdx + 2] = (sData[i00 + 2] * w00 + sData[i10 + 2] * w10 + sData[i01 + 2] * w01 + sData[i11 + 2] * w11) | 0;
        dData[dstIdx + 3] = 255;
      }
    }
    dCtx.putImageData(dImg, 0, 0);
    return dstCanvas;
  }

  /** 自动估计课表外框四角（返回归一化坐标 [{x,y} x 4: TL, TR, BR, BL]） */
  function detectCorners(canvas) {
    if (!canvas) {
      return [{ x: 0.04, y: 0.04 }, { x: 0.96, y: 0.04 }, { x: 0.96, y: 0.96 }, { x: 0.04, y: 0.96 }];
    }
    var lines = detectLines(canvas);
    var w = canvas.width || 1, h = canvas.height || 1;
    var vl = lines.vlines || [], hl = lines.hlines || [];
    var x0 = vl.length >= 2 ? Math.max(0.01, vl[0] / w) : 0.04;
    var x1 = vl.length >= 2 ? Math.min(0.99, vl[vl.length - 1] / w) : 0.96;
    var y0 = hl.length >= 2 ? Math.max(0.01, hl[0] / h) : 0.04;
    var y1 = hl.length >= 2 ? Math.min(0.99, hl[hl.length - 1] / h) : 0.96;
    if (x1 - x0 < 0.4) { x0 = 0.04; x1 = 0.96; }
    if (y1 - y0 < 0.4) { y0 = 0.04; y1 = 0.96; }
    return [
      { x: Number(x0.toFixed(3)), y: Number(y0.toFixed(3)) },
      { x: Number(x1.toFixed(3)), y: Number(y0.toFixed(3)) },
      { x: Number(x1.toFixed(3)), y: Number(y1.toFixed(3)) },
      { x: Number(x0.toFixed(3)), y: Number(y1.toFixed(3)) }
    ];
  }



  /**
   * 彩色课表卡片底纹剥离（Color Card Background Stripping）
   * 解决 WakeUp / 超级课程表 / 教务系统彩色课表截图中：
   * 1) 饱和色块（粉/蓝/绿/紫/橙底纹）转灰度后与文字对比度低；
   * 2) 深色卡片内白字与浅色背景黑字混排，导致固定 64x64 分块反相把汉字切碎。
   *
   * 拆成两层：*Data 版直接改像素数组，canvas 版只是「读出来 → 调 Data 版 → 写回去」。
   * 预处理的四步共用同一份 ImageData，一次读写顶原来四次——4K 截图光来回拷贝就上亿字节。
   */
  function stripColorCardBgData(d, w, h) {
    // 先拷贝一份原始 RGB 供邻域采样，避免原地修改互相污染
    var orig = new Uint8ClampedArray(d);
    var step = Math.max(2, Math.min(6, (w / 200) | 0));
    // 邻域偏移预先算好：这一层循环跑 960 万次，每个像素都算 (ny*w+nx)*4 太亏
    var step4 = step * 4;
    var vStep = step * w * 4;

    var o = 0;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++, o += 4) {
        var r = orig[o], g = orig[o + 1], b = orig[o + 2];
        var maxC = r > g ? (r > b ? r : b) : (g > b ? g : b);
        var minC = r < g ? (r < b ? r : b) : (g < b ? g : b);
        var sat = maxC - minC;
        var lum = (0.299 * r + 0.587 * g + 0.114 * b) | 0;

        if (sat >= 38 && lum >= 75 && lum <= 245) {
          d[o] = d[o + 1] = d[o + 2] = 248;
        } else if (lum >= 235 && sat <= 30) {
          var nbColor = 0, p, nr, ng, nb2, nSat, nLum;
          if (x >= step) {
            p = o - step4;
            nr = orig[p]; ng = orig[p + 1]; nb2 = orig[p + 2];
            nSat = (nr > ng ? (nr > nb2 ? nr : nb2) : (ng > nb2 ? ng : nb2)) -
                   (nr < ng ? (nr < nb2 ? nr : nb2) : (ng < nb2 ? ng : nb2));
            nLum = (0.299 * nr + 0.587 * ng + 0.114 * nb2) | 0;
            if ((nSat >= 38 && nLum < 225) || nLum < 105) nbColor++;
          }
          if (x + step < w) {
            p = o + step4;
            nr = orig[p]; ng = orig[p + 1]; nb2 = orig[p + 2];
            nSat = (nr > ng ? (nr > nb2 ? nr : nb2) : (ng > nb2 ? ng : nb2)) -
                   (nr < ng ? (nr < nb2 ? nr : nb2) : (ng < nb2 ? ng : nb2));
            nLum = (0.299 * nr + 0.587 * ng + 0.114 * nb2) | 0;
            if ((nSat >= 38 && nLum < 225) || nLum < 105) nbColor++;
          }
          if (y >= step) {
            p = o - vStep;
            nr = orig[p]; ng = orig[p + 1]; nb2 = orig[p + 2];
            nSat = (nr > ng ? (nr > nb2 ? nr : nb2) : (ng > nb2 ? ng : nb2)) -
                   (nr < ng ? (nr < nb2 ? nr : nb2) : (ng < nb2 ? ng : nb2));
            nLum = (0.299 * nr + 0.587 * ng + 0.114 * nb2) | 0;
            if ((nSat >= 38 && nLum < 225) || nLum < 105) nbColor++;
          }
          if (y + step < h) {
            p = o + vStep;
            nr = orig[p]; ng = orig[p + 1]; nb2 = orig[p + 2];
            nSat = (nr > ng ? (nr > nb2 ? nr : nb2) : (ng > nb2 ? ng : nb2)) -
                   (nr < ng ? (nr < nb2 ? nr : nb2) : (ng < nb2 ? ng : nb2));
            nLum = (0.299 * nr + 0.587 * ng + 0.114 * nb2) | 0;
            if ((nSat >= 38 && nLum < 225) || nLum < 105) nbColor++;
          }
          if (nbColor >= 2) {
            d[o] = d[o + 1] = d[o + 2] = 28;
          }
        }
      }
    }
    return d;
  }

  function stripColorCardBg(canvas) {
    if (!canvas || !canvas.getContext) return canvas;
    var w = canvas.width, h = canvas.height;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var img;
    try { img = ctx.getImageData(0, 0, w, h); } catch (e) { return canvas; }
    stripColorCardBgData(img.data, w, h);
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  /**
   * 沿检测到的表格网格线绘制纯白隔离带（Grid Line Isolation Gutter）
   * 作用：在保留 lines 坐标供后续归格使用的前提下，把送给 Tesseract 的画布上的表格黑线抹白，
   * 既防止边框线被误识为「一 / | / 1」，又物理阻断相邻两列文字被 LSTM 连成同一行。
   */
  function isolateGridLines(canvas, lines, gutterWidth) {
    if (!canvas || !canvas.getContext || !lines) return canvas;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return canvas;
    var gw = gutterWidth || 4;
    var half = Math.ceil(gw / 2);
    var w = canvas.width, h = canvas.height;
    ctx.save();
    ctx.fillStyle = '#ffffff';
    (lines.vlines || []).forEach(function (vx) {
      ctx.fillRect(Math.max(0, vx - half), 0, gw, h);
    });
    (lines.hlines || []).forEach(function (hy) {
      ctx.fillRect(0, Math.max(0, hy - half), w, gw);
    });
    ctx.restore();
    return canvas;
  }

  /** OTSU：由灰度直方图求最佳阈值 */
  function otsu(hist, total) {
    var sumAll = 0, i;
    for (i = 0; i < 256; i++) sumAll += i * hist[i];
    var sumB = 0, wB = 0, maxVar = -1, th = 128;
    for (i = 0; i < 256; i++) {
      wB += hist[i];
      if (!wB) continue;
      var wF = total - wB;
      if (!wF) break;
      sumB += i * hist[i];
      var mB = sumB / wB, mF = (sumAll - sumB) / wF;
      var v = wB * wF * (mB - mF) * (mB - mF);
      if (v > maxVar) { maxVar = v; th = i; }
    }
    return th;
  }

  /**
   * 轻度增强：灰度 + 2%~98% 分位对比度拉伸
   * 比硬二值化温和：彩色底、发灰的字会变清楚，但笔画不会断
   */
  function enhanceData(d, w, h) {
    var n = w * h;

    var gray = new Uint8Array(n);
    var hist = new Uint32Array(256);
    var i, sum = 0;
    for (i = 0; i < n; i++) {
      var v = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) | 0;
      gray[i] = v; hist[v]++; sum += v;
    }

    // 深色底（夜间模式）整体反相
    var invert = (sum / n) < 110;
    if (invert) for (i = 0; i < n; i++) gray[i] = 255 - gray[i];

    // 局部反相：很多课表表头是深蓝底白字，白字黑底识别率很差
    var TILE = 64;
    for (var ty = 0; ty < h; ty += TILE) {
      for (var tx = 0; tx < w; tx += TILE) {
        var yEnd = Math.min(h, ty + TILE), xEnd = Math.min(w, tx + TILE);
        var darkN = 0, total = 0, x, y;
        for (y = ty; y < yEnd; y++) {
          for (x = tx; x < xEnd; x++) {
            if (gray[y * w + x] < 128) darkN++;
            total++;
          }
        }
        if (total && darkN / total > 0.55) {
          for (y = ty; y < yEnd; y++) {
            for (x = tx; x < xEnd; x++) {
              var gi = y * w + x;
              gray[gi] = 255 - gray[gi];
            }
          }
        }
      }
    }

    // 反相会改变直方图，重新统计后再算分位
    hist = new Uint32Array(256);
    for (i = 0; i < n; i++) hist[gray[i]]++;

    // 2% / 98% 分位
    var lo = 0, hi = 255, acc = 0;
    for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * 0.02) { lo = i; break; } }
    acc = 0;
    for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= n * 0.02) { hi = i; break; } }
    if (hi - lo < 40) { lo = 0; hi = 255; }
    var span = Math.max(1, hi - lo);

    for (i = 0; i < n; i++) {
      var val = (gray[i] - lo) * 255 / span;
      val = val < 0 ? 0 : val > 255 ? 255 : val;
      var o = i * 4;
      d[o] = d[o + 1] = d[o + 2] = val;
      d[o + 3] = 255;
    }
    return d;
  }

  function enhance(canvas) {
    var w = canvas.width, h = canvas.height;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var img;
    try { img = ctx.getImageData(0, 0, w, h); } catch (e) { return canvas; }
    enhanceData(img.data, w, h);
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  /**
   * 兜底用：分块自适应二值化（对比度极低的图才有优势，硬二值会断笔画）
   */
  function binarizeData(d, w, h) {
    var n = w * h;

    var gray = new Uint8Array(n);
    var i, sum = 0;
    for (i = 0; i < n; i++) {
      var v = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) | 0;
      gray[i] = v; sum += v;
    }
    // 夜间模式 / 深色表头：整体偏暗时反相
    var invert = (sum / n) < 110;
    if (invert) for (i = 0; i < n; i++) gray[i] = 255 - gray[i];

    var TILE = 48;
    for (var ty = 0; ty < h; ty += TILE) {
      var yEnd = Math.min(h, ty + TILE);
      for (var tx = 0; tx < w; tx += TILE) {
        var xEnd = Math.min(w, tx + TILE);
        var hist = new Uint32Array(256);
        var cnt = 0, x, y;
        for (y = ty; y < yEnd; y++) {
          for (x = tx; x < xEnd; x++) { hist[gray[y * w + x]]++; cnt++; }
        }
        if (!cnt) continue;
        var th = otsu(hist, cnt);
        // 块内几乎没有对比（纯白/纯色块）时，抬高阈值避免噪点
        if (th < 30) th = 200;
        for (y = ty; y < yEnd; y++) {
          for (x = tx; x < xEnd; x++) {
            var idx = y * w + x;
            var val = gray[idx] <= th ? 0 : 255;
            var o = idx * 4;
            d[o] = d[o + 1] = d[o + 2] = val;
            d[o + 3] = 255;
          }
        }
      }
    }
    return d;
  }

  function binarize(canvas) {
    var w = canvas.width, h = canvas.height;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var img;
    try { img = ctx.getImageData(0, 0, w, h); } catch (e) { return canvas; }
    binarizeData(img.data, w, h);
    ctx.putImageData(img, 0, 0);
    canvas._binary = true;
    return canvas;
  }

  /** 检测表格的横竖线（像素统计），返回 {vlines, hlines} */
  function detectLinesData(data, w, h, isBinary) {
    var dark = new Uint8Array(w * h);
    for (var i = 0; i < w * h; i++) {
      var r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      dark[i] = (0.299 * r + 0.587 * g + 0.114 * b) < (isBinary ? 128 : 150) ? 1 : 0;
    }

    var vScore = new Float32Array(w);
    for (var x = 0; x < w; x++) {
      var cnt = 0;
      for (var y = 0; y < h; y++) cnt += dark[y * w + x];
      vScore[x] = cnt / h;
    }
    var hScore = new Float32Array(h);
    for (var y2 = 0; y2 < h; y2++) {
      var c2 = 0;
      for (var x2 = 0; x2 < w; x2++) c2 += dark[y2 * w + x2];
      hScore[y2] = c2 / w;
    }

    function peaks(arr, thresh, minGap) {
      var raw = [], run = null;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] > thresh) {
          if (!run) run = { s: i, e: i };
          else run.e = i;
        } else if (run) {
          raw.push(Math.round((run.s + run.e) / 2));
          run = null;
        }
      }
      if (run) raw.push(Math.round((run.s + run.e) / 2));
      var out = [];
      raw.forEach(function (p) {
        if (!out.length || p - out[out.length - 1] > minGap) out.push(p);
        else out[out.length - 1] = Math.round((out[out.length - 1] + p) / 2);
      });
      return out;
    }

    // 竖线需要贯穿较多高度；横线贯穿较多宽度
    var vlines = peaks(vScore, 0.34, Math.max(6, w * 0.012));
    var hlines = peaks(hScore, 0.32, Math.max(6, h * 0.015));

    // 表格外框常常贴着图片边缘，补上边缘，避免最后一列被切掉
    if (vlines.length) {
      if (vlines[0] > w * 0.02) vlines.unshift(0);
      if (vlines[vlines.length - 1] < w * 0.98) vlines.push(w);
    }
    if (hlines.length) {
      if (hlines[0] > h * 0.02) hlines.unshift(0);
      if (hlines[hlines.length - 1] < h * 0.98) hlines.push(h);
    }
    return { vlines: vlines, hlines: hlines };
  }

  function detectLines(canvas) {
    var w = canvas.width, h = canvas.height;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var data;
    try {
      data = ctx.getImageData(0, 0, w, h).data;
    } catch (e) {
      return { vlines: [], hlines: [] };
    }
    return detectLinesData(data, w, h, !!canvas._binary);
  }

  /**
   * 一次跑完预处理四步：去底纹 → 增强/二值化 → 找线 → 抹线。
   *
   * 关键在「一次读写」：四步都要同一份像素，以前是各自 getImageData/putImageData，
   * 一张 2400×4000 的截图就是四次近 40MB 的来回拷贝，主线程直接卡住；
   * 现在只读一次、写一次，算法本身一行没改，输出逐像素一致。
   * 中间还让出两次主线程，进度条和「取消」按钮才有机会响应。
   */
  function preprocessCanvas(canvas, opts) {
    opts = opts || {};
    var w = canvas.width, h = canvas.height;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var img;
    try { img = ctx.getImageData(0, 0, w, h); } catch (e) { return Promise.resolve(null); }
    var d = img.data;

    stripColorCardBgData(d, w, h);
    var step = function () { return new Promise(function (r) { setTimeout(r, 0); }); };

    return step().then(function () {
      if (opts.binary) binarizeData(d, w, h);
      else enhanceData(d, w, h);
      return step();
    }).then(function () {
      // 找线要在抹线之前算：抹完线就找不到线了，但归格还要用这些坐标
      var lines = detectLinesData(d, w, h, !!opts.binary);
      ctx.putImageData(img, 0, 0);
      if (lines && ((lines.vlines && lines.vlines.length >= 4) || (lines.hlines && lines.hlines.length >= 4))) {
        isolateGridLines(canvas, lines, 4);
      }
      return lines;
    });
  }

  /** 单次识别：增强图 → Tesseract（返回原始结果，支持直接传入已透视矫正的 opts.canvas） */
  function recognizeOnce(file, opts, onProgress) {
    opts = opts || {};
    var norm;
    var initPromise = opts.canvas ? new Promise(function (resolve) {
      var c = document.createElement('canvas');
      c.width = opts.canvas.width;
      c.height = opts.canvas.height;
      c.getContext('2d').drawImage(opts.canvas, 0, 0);
      c.toBlob(function (b) {
        resolve({ blob: b, canvas: c, width: c.width, height: c.height });
      }, 'image/png');
    }) : normalizeImage(file);
    var lines = null;
    return initPromise.then(function (n) {
      norm = n;
      if (onProgress) onProgress({ status: '正在分析表格结构与去噪…', progress: 0.05 });
      // raw：原图直接送识别，不走「去底纹 + 对比度拉伸 + 抹网格线」。
      // 干净的截图走这条路明显更准——预处理那些步骤是给「拍照/彩色底」准备的，
      // 用在本来就很清楚的截图上反而会把抗锯齿的笔画拉粗、被抹线切碎。
      if (opts.raw) return null;
      return preprocessCanvas(n.canvas, opts).then(function (l) { lines = l; });
    }).then(function () {
      return new Promise(function (resolve) {
        norm.canvas.toBlob(function (b) { norm.blob = b; resolve(); }, 'image/png');
      });
    }).then(function () {
      return loadLib().then(function (T) {
        // createWorker 才能显式要求输出 TSV（v5+ 默认不返回坐标）
        return T.createWorker('chi_sim', 1, {
          workerPath: WORKER,
          corePath: CORE,
          langPath: LANG,
          logger: function (m) { if (onProgress) onProgress(m); }
        }).then(function (worker) {
          try {
            worker.setParameters({
              // PSM 4：单列、字号不一。实测比 6（整块）和 3（自动）漏字少得多
              tessedit_pageseg_mode: opts.psm || '4',
              preserve_interword_spaces: '1',
              user_defined_dpi: '300'
            });
          } catch (_) {}
          return worker.recognize(norm.blob, {}, { text: true, tsv: true, blocks: true })
            .then(function (res) {
              return worker.terminate().then(function () { return res; });
            })
            .catch(function (e) {
              try { worker.terminate(); } catch (_) {}
              throw e;
            });
        });
      }).then(function (res) {
        return parseResult(res, norm, lines);
      });
    });
  }

  /** Tesseract 结果 → { words, text, width, height, lines } */
  function parseResult(res, norm, lines) {
    var data = res.data || {};
    var words = (data.words || []).map(function (w) {
      return {
        text: (w.text || '').trim(),
        conf: w.confidence == null ? 100 : w.confidence,
        x0: w.bbox.x0, y0: w.bbox.y0,
        x1: w.bbox.x1, y1: w.bbox.y1,
        cx: (w.bbox.x0 + w.bbox.x1) / 2,
        cy: (w.bbox.y0 + w.bbox.y1) / 2
      };
    }).filter(function (w) { return w.text && w.conf > 25; });

    // 老版本没有 words 时退化为 lines
    if (!words.length && data.lines) {
      words = data.lines.map(function (l) {
        return {
          text: (l.text || '').trim(), conf: l.confidence == null ? 100 : l.confidence,
          x0: l.bbox.x0, y0: l.bbox.y0, x1: l.bbox.x1, y1: l.bbox.y1,
          cx: (l.bbox.x0 + l.bbox.x1) / 2, cy: (l.bbox.y0 + l.bbox.y1) / 2
        };
      }).filter(function (w) { return w.text; });
    }

    // v5/v6 只给 TSV：从中解析 word 级坐标
    if (!words.length && data.tsv) words = parseTsv(data.tsv);

    words = words.filter(function (w) { return !isNoise(w.text); });

    return {
      words: words, text: data.text || '',
      width: norm.width, height: norm.height, lines: lines || null
    };
  }

  /** 表格线被认成「|」「—」「=」之类，直接丢掉 */
  function isNoise(text) {
    var t = String(text || '').trim();
    if (!t) return true;
    if (/^[\p{P}\p{S}\s]+$/u.test(t)) return true;
    return false;
  }

  /** 本地识别：返回 words（含坐标），失败时自动换一种切分方式重试 */
  /** 一次识别结果里认出了多少个汉字——用来在几种切分策略之间比大小 */
  function cjkCount(r) {
    if (!r || !r.words || !r.words.length) return 0;
    var n = 0;
    r.words.forEach(function (w) {
      var m = String(w.text).match(/[\u4e00-\u9fa5]/g);
      if (m) n += m.length;
    });
    return n;
  }

  /** 平均置信度，用来避免「认出一堆乱码但字数很多」的假胜出 */
  function avgConf(r) {
    if (!r || !r.words || !r.words.length) return 0;
    var s = 0;
    r.words.forEach(function (w) { s += (typeof w.conf === 'number' ? w.conf : 0); });
    return s / r.words.length;
  }

  /**
   * 本地识别：按几种切分方式各试一遍，取认出汉字最多的那次。
   *
   * 之前是「PSM 4 → 词太少再试 PSM 11」，而且第一遍出 0 个词就直接返回——等于对表格截图
   * 恰好在最该重试的时候放弃了。实测同一张教务系统风格课表（1400×900）：
   *   原图 + PSM 11 → 表头、课程名、教师地点几乎全中
   *   原图 + PSM 4  → 一个字都认不出
   *   增强后 + PSM 11 → 只剩「周三 周焉 禺图」这类乱码
   * 所以拿「原图 + PSM 11」打头，预处理版留作拍照/脏底的兜底；
   * 一旦某遍已经认得足够好就提前收工，正常截图仍然只跑一遍。
   */
  function recognizeLocal(file, onProgress, extraOpts) {
    extraOpts = extraOpts || {};
    var canvas = extraOpts.canvas;
    var tries = [
      { psm: '11', raw: true, status: '正在识别…' },
      { psm: '11', raw: false, status: '换个方式再识别一次…' },
      { psm: '6', raw: false, status: '再换一种切分试试…' },
      { psm: '11', raw: false, binary: true, status: '换二值化再试一次…' }
    ];
    var best = null;

    function step(i) {
      if (i >= tries.length) return Promise.resolve(best);
      if (onProgress) onProgress({ status: tries[i].status, progress: 0.2 + i * 0.15 });
      return recognizeOnce(file, {
        psm: tries[i].psm, raw: tries[i].raw, binary: tries[i].binary, canvas: canvas
      }, onProgress)
        .catch(function () { return null; })
        .then(function (r) {
          if (r && (!best || cjkCount(r) > cjkCount(best) ||
              (cjkCount(r) === cjkCount(best) && avgConf(r) > avgConf(best)))) {
            best = r;
          }
          // 已经认够多了就别再耗时间
          if (best && cjkCount(best) >= 24 && avgConf(best) >= 68) return best;
          return step(i + 1);
        });
    }

    return step(0).then(function (r) {
      return r || { words: [], text: '', width: 0, height: 0, lines: null };
    });
  }

  /** 解析 Tesseract TSV，取 word 级（level=5）文本与坐标 */
  function parseTsv(tsv) {
    var out = [];
    var lines = String(tsv || '').split(/\r?\n/);
    for (var i = 1; i < lines.length; i++) {
      var p = lines[i].split('\t');
      if (p.length < 12 || p[0] !== '5') continue;
      var text = (p[11] || '').trim();
      if (!text) continue;
      var conf = parseFloat(p[10]);
      if (!(conf > 20)) continue;
      var x0 = +p[6], y0 = +p[7], w = +p[8], h = +p[9];
      if (!w || !h) continue;
      out.push({
        text: text, conf: conf,
        x0: x0, y0: y0, x1: x0 + w, y1: y0 + h,
        cx: x0 + w / 2, cy: y0 + h / 2
      });
    }
    return out;
  }

  /* ==========================================================
   * 表格还原
   * ========================================================== */
  var DAY_WORDS = ['一', '二', '三', '四', '五', '六', '日', '天'];
  var CN_NUM = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8,
                 '九': 9, '十': 10, '日': 7, '天': 7 };
  var FULL_NUM = { '１': '1', '２': '2', '３': '3', '４': '4', '５': '5',
                   '６': '6', '７': '7', '８': '8', '９': '9', '０': '0' };

  /** 表头里那些「不是课程」的词 */
  var META_WORDS = ['时间', '节次', '课时', '课程', '课程名', '教室', '地点', '上课地点',
                    '教师', '任课教师', '老师', '备注', '上午', '下午', '晚上', '中午',
                    '日期', '星期', '周次', '节数'];

  function norm(s) {
    return String(s || '').replace(/[\s:：]/g, '')
      .replace(/[１-９０]/g, function (c) { return FULL_NUM[c] || c; });
  }

  function byY(a, b) { return a.cy - b.cy || a.cx - b.cx; }

  function median(arr) {
    if (!arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    return s[Math.floor(s.length / 2)];
  }

  function medianHeight(words) {
    return median(words.map(function (w) { return (w.y1 - w.y0) || 12; })) || 14;
  }

  /** 按 cy 聚成一簇簇（同一行） */
  function clusterByY(items, tol) {
    var arr = items.slice().sort(byY);
    var out = [], cur = null;
    arr.forEach(function (w) {
      if (!cur || Math.abs(w.cy - cur.last) > tol) {
        cur = { items: [w], last: w.cy };
        out.push(cur);
      } else {
        cur.items.push(w);
        cur.last = w.cy;
      }
    });
    return out.map(function (c) { return c.items; });
  }

  /** 「星期一 / 周三 / 一 / Mon」→ 1-7，不是星期返回 0 */
  function dayOf(text) {
    var t = norm(text);
    if (!t || t.length > 4) return 0;
    // 破折号、下划线常是「一」被认错
    t = t.replace(/^((?:星期|周|礼拜))[—–\-_－]+$/, '$1一');
    var m = t.match(/^(?:星期|周|礼拜)?([一二三四五六日天1-7])$/);
    if (m) return CN_NUM[m[1]] || (parseInt(m[1], 10) || 0);
    var low = t.toLowerCase();
    var en = [['mon', 1], ['tues', 2], ['tue', 2], ['wed', 3], ['thu', 4], ['thur', 4],
              ['fri', 5], ['sat', 6], ['sun', 7]];
    for (var i = 0; i < en.length; i++) {
      if (low.indexOf(en[i][0]) === 0) return en[i][1];
    }
    return 0;
  }

  /**
   * 节次词判定
   * @returns 正数=节次序号；-1=是节次但序号认不出（如「第]节」）；0=不是节次
   */
  function periodOf(text) {
    var t = norm(text);
    if (t.length > 6) return 0;
    var isP = /^第.{0,3}节$/.test(t) || /^\d{1,2}节$/.test(t) || /^[一二三四五六七八九十]{1,2}节$/.test(t);
    if (!isP) return 0;
    var dm = t.match(/\d{1,2}/);
    var n = dm ? parseInt(dm[0], 10) : 0;
    if (!n) {
      var cm = t.match(/[一二三四五六七八九十]/);
      n = cm ? (CN_NUM[cm[0]] || 0) : 0;
    }
    return (n >= 1 && n <= 20) ? n : -1;
  }

  /** 「08:00」「8:00-8:45」这类时间文本 */
  function isTime(text) {
    var s = String(text || '').replace(/\s/g, '');
    return /^\d{1,2}[:：]\d{2}/.test(s) ||
           /^\d{1,2}[:：]\d{2}\s*[-~—至]\s*\d{1,2}[:：]\d{2}$/.test(s);
  }

  /** 表头里的标签词（时间/节次/课程…） */
  function isMeta(text) {
    var t = norm(text);
    if (!t || t.length > 6) return false;
    for (var i = 0; i < META_WORDS.length; i++) {
      if (t === META_WORDS[i]) return true;
    }
    return false;
  }

  /**
   * 把识别出的词还原成网格
   * @returns { cols:[{x,label}], rows:[{y,label}], cells:[[string]] }
   */
  /**
   * 把识别出的词还原成网格
   * 关键点：先认出「星期表头」和「节次/时间列」，把它们排除在课程格之外
   * @returns { cols:[{x,x0,x1,label,day}], rows:[{y,label,periodIndex}], cells:[[string]] }
   */
  function buildGrid(words, opts) {
    opts = opts || {};
    if (!words || !words.length) {
      return { cols: defaultCols(), rows: [], cells: [], conf: [] };
    }
    if (opts.customLines && opts.customLines.vlines && opts.customLines.vlines.length >= 5 &&
        opts.customLines.hlines && opts.customLines.hlines.length >= 3) {
      var byCustom = buildFromLines(words, opts.customLines);
      if (byCustom && byCustom.rows.length) {
        byCustom.meta = { dayHeaders: 7, rowsByLines: true, customGrid: true };
        return byCustom;
      }
    }

    var list = words.map(function (w) {
      var t = norm(w.text);
      return {
        text: w.text, conf: w.conf, x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1,
        cx: w.cx, cy: w.cy,
        day: dayOf(t), period: periodOf(t), time: isTime(w.text), meta: isMeta(t)
      };
    });

    var minX = Math.min.apply(null, list.map(function (w) { return w.x0; }));
    var maxX = Math.max.apply(null, list.map(function (w) { return w.x1; }));
    var minY = Math.min.apply(null, list.map(function (w) { return w.y0; }));
    var maxY = Math.max.apply(null, list.map(function (w) { return w.y1; }));
    var W = Math.max(1, maxX - minX), H = Math.max(1, maxY - minY);
    var mh = medianHeight(list);

    /* ---- 1. 表头行：星期词最多的那一簇 ---- */
    var dayWords = list.filter(function (w) { return w.day; });
    var headDays = [], headBottom = -1;
    if (dayWords.length >= 3) {
      var clusters = clusterByY(dayWords, mh * 1.8);
      clusters.sort(function (a, b) { return b.length - a.length || a[0].cy - b[0].cy; });
      var top = clusters[0];
      if (top.length >= 3) {
        var seen = {};
        top.sort(function (a, b) { return a.cx - b.cx; }).forEach(function (w) {
          if (seen[w.day]) return;
          seen[w.day] = 1;
          headDays.push(w);
        });
      }
      if (headDays.length >= 3) {
        headBottom = Math.max.apply(null, headDays.map(function (w) { return w.y1; })) + mh * 0.5;
      } else {
        headDays = [];
      }
    }

    /* ---- 2. 列：竖线优先，其次星期表头，最后均分 ---- */
    var L = opts.lines;
    var vlines = (L && L.vlines) || [];
    var hlines = (L && L.hlines) || [];
    var colRanges = null;

    if (vlines.length >= 5) {
      var all = [];
      for (var vi = 0; vi < vlines.length - 1; vi++) {
        all.push({ x0: vlines[vi], x1: vlines[vi + 1] });
      }
      // 8 段 = 节次 + 7 天；多出来的都在左边，取最后 7 段最稳
      if (all.length > 7) all = all.slice(all.length - 7);
      if (all.length >= 3) colRanges = all;
    }

    var cols = [], tableLeft, tableRight;

    if (colRanges) {
      var lastDay = 0;
      cols = colRanges.map(function (r, i) {
        var d = 0;
        headDays.forEach(function (w) {
          if (w.cx >= r.x0 - mh && w.cx <= r.x1 + mh) d = w.day;
        });
        if (!d) d = lastDay + 1;          // 表头缺字时按顺序推
        if (d > 7) d = 7;
        lastDay = d;
        return { x: (r.x0 + r.x1) / 2, x0: r.x0, x1: r.x1, day: d, label: '周' + DAY_WORDS[d - 1] };
      });
      tableLeft = cols[0].x0;
      tableRight = cols[cols.length - 1].x1;
    } else if (headDays.length >= 4) {
      var gap = headDays.length > 1 ? (headDays[1].cx - headDays[0].cx) : W * 0.12;
      tableLeft = headDays[0].cx - gap / 2;
      tableRight = headDays[headDays.length - 1].cx + gap / 2;
      cols = headDays.map(function (w, i) {
        var x0 = i === 0 ? tableLeft : (headDays[i - 1].cx + w.cx) / 2;
        var x1 = i === headDays.length - 1 ? tableRight : (w.cx + headDays[i + 1].cx) / 2;
        return { x: w.cx, x0: x0, x1: x1, day: w.day, label: '周' + DAY_WORDS[w.day - 1] };
      });
    } else {
      tableLeft = minX + W * 0.14;
      tableRight = maxX;
      var step = (tableRight - tableLeft) / 7;
      for (var k = 0; k < 7; k++) {
        cols.push({
          x: tableLeft + step * (k + 0.5),
          x0: tableLeft + step * k, x1: tableLeft + step * (k + 1),
          day: k + 1, label: '周' + DAY_WORDS[k]
        });
      }
    }

    /* ---- 3. 行：左侧「第X节 / 时间」当锚点，其次用横线 ---- */
    var leftWords = list.filter(function (w) { return w.cx < tableLeft - mh * 0.2; });
    var periodWords = leftWords.filter(function (w) { return w.period; });
    var timeWords = leftWords.filter(function (w) { return w.time; });

    var anchors = [];
    if (periodWords.length >= 2) {
      anchors = clusterByY(periodWords, mh * 1.6).map(function (g) {
        return { y: median(g.map(function (w) { return w.cy; })), words: g,
                 period: g[0].period > 0 ? g[0].period : 0 };
      });
    } else if (timeWords.length >= 2) {
      anchors = clusterByY(timeWords, mh * 1.6).map(function (g, i) {
        return { y: median(g.map(function (w) { return w.cy; })), words: g, period: i + 1 };
      });
    } else if (leftWords.length >= 2) {
      anchors = clusterByY(leftWords, mh * 2.2).map(function (g, i) {
        return { y: median(g.map(function (w) { return w.cy; })), words: g, period: i + 1 };
      });
    }

    var rows = [];
    if (anchors.length >= 2) {
      // 以节次/时间为锚点，行边界取相邻锚点的中点（不会互相重叠）
      rows = anchors.map(function (a, i) {
        var prev = anchors[i - 1], next = anchors[i + 1];
        return {
          y: a.y,
          y0: prev ? (prev.y + a.y) / 2 : a.y - mh * 2,
          y1: next ? (a.y + next.y) / 2 : a.y + mh * 2,
          label: a.words.map(function (w) { return w.text; }).join(' '),
          periodIndex: a.period > 0 ? a.period : (i + 1)
        };
      });
    } else if (hlines.length >= 3) {
      // 没有节次列：用横线切行
      var valid = hlines.filter(function (y) { return headBottom < 0 || y >= headBottom - mh; });
      if (valid.length < 2) valid = hlines;
      for (var hj = 0; hj < valid.length - 1; hj++) {
        var yy0 = valid[hj], yy1 = valid[hj + 1];
        if (yy1 - yy0 < mh * 0.8) continue;
        var lb = '';
        leftWords.forEach(function (w) {
          if (w.cy >= yy0 - mh * 0.5 && w.cy <= yy1 + mh * 0.5) {
            lb = lb ? lb + ' ' + w.text : w.text;
          }
        });
        rows.push({
          y: (yy0 + yy1) / 2, y0: yy0, y1: yy1, label: lb,
          periodIndex: rows.length + 1
        });
      }
    } else {
      // 没有任何结构：按正文的 y 聚类
      var body = list.filter(function (w) {
        return w.cx >= tableLeft && (headBottom < 0 || w.cy > headBottom);
      });
      var groups = clusterByY(body, mh * 1.3);
      rows = groups.map(function (g, i) {
        return {
          y: median(g.map(function (w) { return w.cy; })),
          y0: null, y1: null,
          label: '第 ' + (i + 1) + ' 节', periodIndex: i + 1
        };
      });
    }

    rows.forEach(function (r, i) { r.index = i; });

    /* ---- 4. 词归格：表头 / 节次 / 时间一律不算课程 ---- */
    var cells = rows.map(function () {
      return cols.map(function () { return []; });
    });

    function rowIndexOf(cy) {
      for (var r = 0; r < rows.length; r++) {
        var y0 = rows[r].y0 != null ? rows[r].y0 : rows[r].y - mh * 1.2;
        var y1 = rows[r].y1 != null ? rows[r].y1 : rows[r].y + mh * 1.2;
        if (cy >= y0 && cy <= y1) return r;
      }
      return nearestIndex(rows, cy, mh * 3);
    }

    var body = list.filter(function (w) {
      if (w.day || w.period || w.time || w.meta) return false;
      if (headBottom >= 0 && w.cy < headBottom) return false;
      return w.cx >= tableLeft;
    });

    rows.forEach(function (row, ri) {
      var inRow = body.filter(function (w) { return rowIndexOf(w.cy) === ri; });
      if (!inRow.length) return;

      var colW = (tableRight - tableLeft) / Math.max(1, cols.length);
      var gapLimit = Math.max(mh * 1.2, colW * 0.22);
      clusterByY(inRow, mh * 0.9).forEach(function (line) {
        line.sort(function (a, b) { return a.cx - b.cx; });
        // 一行里可能并排着几个格子的文字：按间距切成段，每段整体归到最近的一列
        var segs = [], cur = [line[0]];
        for (var i = 1; i < line.length; i++) {
          if (line[i].x0 - line[i - 1].x1 > gapLimit) { segs.push(cur); cur = [line[i]]; }
          else cur.push(line[i]);
        }
        segs.push(cur);

        segs.forEach(function (seg) {
          // 「大学英语(1-16周)」这类长文字会溢出格子，用中位位置定它真正的格子
          var medCx = median(seg.map(function (w) { return w.cx; }));
          var ci = nearestIndex(cols, medCx);
          if (ci < 0) return;
          seg.forEach(function (w) { cells[ri][ci].push(w); });
        });
      });
    });

    var flat = flattenCells(cells);
    var out = flat.texts, outConf = flat.confs;

    // 尾部整行都空就丢掉
    while (rows.length && out[out.length - 1].every(function (t) { return !t; })) {
      rows.pop(); out.pop(); outConf.pop();
    }

    return {
      cols: cols, rows: rows, cells: out, conf: outConf,
      meta: { headBottom: headBottom, tableLeft: tableLeft, tableRight: tableRight,
              dayHeaders: headDays.length, rowsByLines: !!(hlines.length >= 3),
              anchors: anchors.length, periodWords: periodWords.length,
              timeWords: timeWords.length, leftWords: leftWords.length }
    };
  }

  /** 备用：只用表格线划分（保留给调试/外部调用） */
  function buildFromLines(words, lines) {
    if (!words || !words.length || !lines) return null;
    var v = lines.vlines || [], hz = lines.hlines || [];
    if (v.length < 5 || hz.length < 3) return null;

    var list = words.map(function (w) {
      var t = norm(w.text);
      return {
        text: w.text, conf: w.conf, cx: w.cx, cy: w.cy,
        x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1,
        day: dayOf(t), period: periodOf(t), time: isTime(w.text), meta: isMeta(t)
      };
    });
    var mh = medianHeight(list);
    var dayWords = list.filter(function (w) { return w.day; });

    var start = 0;
    if (dayWords.length >= 3) {
      var minD = Math.min.apply(null, dayWords.map(function (w) { return w.cx; }));
      for (var s = 0; s < v.length - 1; s++) {
        if (v[s] < minD && v[s + 1] > minD) { start = s; break; }
      }
    } else if (v.length > 8) {
      start = v.length - 8;
    }
    var nCol = Math.min(7, v.length - 1 - start);
    if (nCol < 3) return null;

    var colRanges = [];
    for (var i = 0; i < nCol; i++) {
      colRanges.push({
        x0: v[start + i], x1: v[start + i + 1],
        day: i + 1, label: '周' + DAY_WORDS[i]
      });
    }

    var rowRanges = [];
    for (var j = 0; j < hz.length - 1; j++) rowRanges.push({ y0: hz[j], y1: hz[j + 1] });

    var buckets = rowRanges.map(function () {
      return colRanges.map(function () { return []; });
    });

    list.forEach(function (w) {
      if (w.day || w.period || w.time || w.meta) return;
      var ci = -1, ri = -1;
      for (var c = 0; c < colRanges.length; c++) {
        if (w.cx >= colRanges[c].x0 && w.cx <= colRanges[c].x1) { ci = c; break; }
      }
      for (var r = 0; r < rowRanges.length; r++) {
        if (w.cy >= rowRanges[r].y0 && w.cy <= rowRanges[r].y1) { ri = r; break; }
      }
      if (ci >= 0 && ri >= 0) buckets[ri][ci].push(w);
    });

    var flat = flattenCells(buckets);
    var cells = flat.texts, confs = flat.confs;
    var rows = rowRanges.map(function (r, i) {
      return { y: (r.y0 + r.y1) / 2, label: '第 ' + (i + 1) + ' 节', periodIndex: i + 1, index: i };
    });
    while (rows.length && cells[cells.length - 1].every(function (t) { return !t; })) {
      rows.pop(); cells.pop(); confs.pop();
    }
    return { cols: colRanges, rows: rows, cells: cells, conf: confs };
  }

  /**
   * 网格 → 课程明细。
   * 界面与离线基准都调这一份，避免「测试跑的逻辑」和「线上跑的逻辑」是两套。
   * @param grid buildGrid 的返回
   * @param periods 节次表（Store.periods），可为空
   * @param totalWeeks 学期总周数，用于解析「1-16周」
   */
  function gridToItems(grid, periods, totalWeeks) {
    periods = periods || [];
    totalWeeks = totalWeeks || 20;
    var items = [];
    if (!grid || !grid.rows || !grid.cols) return items;

    grid.rows.forEach(function (row, ri) {
      var pIdx = (row.periodIndex || (ri + 1)) - 1;
      var period = periods[pIdx];
      grid.cols.forEach(function (col, ci) {
        var text = (grid.cells[ri] && grid.cells[ri][ci]) || '';
        if (!text.trim()) return;
        var info = parseCell(text);
        if (!info.name) return;
        // 漏网的表头（星期几 / 第几节 / 时间）不算课程
        if (dayOf(info.name) || periodOf(info.name) || isTime(info.name) || isMeta(info.name)) return;
        var wk = parseWeeks(info.weeks, totalWeeks) ||
                 { weekType: 'all', startWeek: 1, endWeek: totalWeeks };
        items.push({
          day: col.day,
          periodIndex: pIdx + 1,
          periodId: period ? period.id : '',
          periodName: period ? period.name : ('第 ' + (pIdx + 1) + ' 节'),
          name: info.name,
          correctedFrom: info.correctedFrom || '',
          conf: confAt(grid, ri, ci),
          location: info.location || '',
          teacher: info.teacher || '',
          weeks: info.weeks || '',
          weekType: wk.weekType,
          startWeek: wk.startWeek,
          endWeek: wk.endWeek,
          raw: text
        });
      });
    });
    return items;
  }

  /**
   * 一格的平均置信度（0–100），空格返回 null。
   * 用途：核对界面按它标黄/标红，让人一眼看到该重点改哪几格。
   * 取平均而不是最低值——一个格子里「高等数学」认对了、后面周次认糊了，
   * 平均分才会落在中间档；取最低值会把整格打成红色，反而失去区分度。
   */
  function cellConf(arr) {
    if (!arr || !arr.length) return null;
    var s = 0, n = 0;
    arr.forEach(function (w) {
      if (typeof w.conf === 'number' && isFinite(w.conf)) { s += w.conf; n++; }
    });
    return n ? Math.round(s / n) : null;
  }

  /** 置信度分级阈值：低于 LOW 标红（基本得改），低于 MID 标黄（值得看一眼） */
  var CONF_LOW = 62, CONF_MID = 82;

  /** null/高 → ''，中 → 'mid'，低 → 'low' */
  function confLevel(c) {
    if (c == null || typeof c !== 'number' || !isFinite(c)) return '';
    if (c < CONF_LOW) return 'low';
    if (c < CONF_MID) return 'mid';
    return '';
  }

  /** 安全取一格的置信度：网格增删行后可能对不齐，取不到就当没有 */
  function confAt(grid, ri, ci) {
    if (!grid || !grid.conf || !grid.conf[ri]) return null;
    var v = grid.conf[ri][ci];
    return (typeof v === 'number' && isFinite(v)) ? v : null;
  }

  /**
   * 统计网格里的「存疑格」。
   * @param grid buildGrid 的返回
   * @param touched {'r,c':1} 用户已经手动改过的格子——改过就不算存疑
   */
  function confStats(grid, touched) {
    var st = { low: 0, mid: 0, filled: 0, suspect: 0 };
    if (!grid || !grid.cells) return st;
    grid.cells.forEach(function (row, ri) {
      (row || []).forEach(function (t, ci) {
        if (!String(t == null ? '' : t).trim()) return;
        st.filled++;
        if (touched && touched[ri + ',' + ci]) return;
        var lv = confLevel(confAt(grid, ri, ci));
        if (lv === 'low') st.low++;
        else if (lv === 'mid') st.mid++;
      });
    });
    st.suspect = st.low + st.mid;
    return st;
  }

  /** cells(词数组) → 文本矩阵 + 置信度矩阵 */
  function flattenCells(cells) {
    var texts = [], confs = [];
    cells.forEach(function (row) {
      texts.push(row.map(joinCell));
      confs.push(row.map(cellConf));
    });
    return { texts: texts, confs: confs };
  }

  /** 把同一格里的词按行拼成文本 */
  function joinCell(arr) {
    if (!arr.length) return '';
    arr.sort(function (a, b) { return a.cy - b.cy || a.cx - b.cx; });

    // 行阈值按字高动态计算
    var heights = arr.map(function (w) { return w.y1 - w.y0; }).sort(function (a, b) { return a - b; });
    var medH = heights[Math.floor(heights.length / 2)] || 16;
    var lineGap = Math.max(6, medH * 0.75);

    var lines = [], lastY = null;
    arr.forEach(function (w) {
      if (lastY == null || Math.abs(w.cy - lastY) > lineGap) {
        lines.push([]); lastY = w.cy;
      }
      lines[lines.length - 1].push(w);
    });

    return lines.map(function (line) {
      // 同一行内按 x 再排一次，修正 OCR 输出的词序
      line.sort(function (a, b) { return a.cx - b.cx; });
      var s = '';
      line.forEach(function (w, i) {
        var prev = line[i - 1];
        if (prev && /[A-Za-z0-9]$/.test(prev.text) && /^[A-Za-z0-9]/.test(w.text)) s += ' ';
        s += w.text;
      });
      return s;
    }).join('\n');
  }

  function nearestIndex(list, v, tolerance) {
    var best = -1, bestD = Infinity;
    for (var i = 0; i < list.length; i++) {
      var d = Math.abs(list[i].x != null ? list[i].x - v : list[i].y - v);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (tolerance != null && bestD > tolerance) return -1;
    return best;
  }

  function defaultCols() {
    return DAY_WORDS.map(function (d, i) {
      return { x: 0, label: '周' + d, day: i + 1 };
    });
  }

  /* ==========================================================
   * 单元格拆分：课程名 / 地点 / 教师 / 周次
   * ========================================================== */
  var CN = '\\u4e00-\\u9fa5';

  var LOC_RES = [
    // 综合楼/教学楼/理教/文科楼/机房/实验室/操场/体育馆...
    new RegExp('[' + CN + 'A-Za-z0-9]{0,8}(?:教学楼|实验楼|办公楼|综合楼|图书馆|体育馆|体育中心|机房|语音室|实验室|报告厅|阶梯教室|多媒体教室|会议室|大礼堂|操场|田径场|篮球场|网球场|风雨操场)'),
    // 主楼/理教/文科楼/工训/综教/东阶/西阶/研楼 + 教室编号
    new RegExp('(?:主楼|理教|文科楼|逸夫馆|工训|综教|东阶|西阶|研楼|主校区|南校区|北校区)\s*[-—－=＝]?\s*[A-Za-z0-9]{0,3}\s*\d{2,4}'),
    // 教三-301 / 逸夫馆A201 / 三教301 / 教=301
    /[东南西北]?[一二三四五六七八九十\d]?\s?[教馆厅室房幢]\s*[一二三四五六七八九十]?\s*[-—－=＝]?\s*[A-Za-z0-9]{0,2}\s?\d{2,4}/,
    // 明理楼 302 / 逸夫馆A201 / 一教 101
    new RegExp('[' + CN + ']{1,6}[楼馆厅堂幢]\s?[-—]?\s?[A-Za-z0-9]{0,2}\s?\d{2,4}'),
    // A101 / B-302 / N 201
    /[A-Za-z]{1,3}\s?[-—]?\s?\d{2,4}/,
    // 3号楼 / 201室 / 2号机房
    /\d{1,3}\s?[号楼室幢座]/
  ];

  var TEACHER_RE = new RegExp('(?:(?:教师|老师|讲师)[:：]\s*[' + CN + ']{2,4})|([' + CN + ']{2,4}(?:老师|教授|讲师|副教授|助教|院士))');

  var WEEK_RE = /\d{1,2}\s*[-~—－至]\s*\d{1,2}\s*(?:周|\(?(?:单|双)周?\)?)|(?:\d{1,2}\s*周)|单周|双周|全周|前\s*\d{1,2}\s*周|后\s*\d{1,2}\s*周/g;

  function tidy(s) {
    return String(s || '')
      .replace(/[（(]\s*[）)]/g, ' ')
      .replace(/[,，、;；]+$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /** 课程名清理：去掉首尾的引号/竖线/破折号，以及没闭合的半个括号 */
  function tidyName(s) {
    return tidy(String(s || '')
      .replace(/^[\s"'“”‘’「」『』|｜·•\-—_=]+/, '')
      .replace(/[\s"'“”‘’「」『』|｜·•\-—_=]+$/, '')
      .replace(/[（(][^）)]*$/, '')
      .trim());
  }

  /** 从一个片段里抽取周次 / 教师 / 地点，剩下的归入课程名或备注 */
  function takeFields(seg, out, names, notes) {
    var s = String(seg || '').trim();
    if (!s) return;

    s = s.replace(WEEK_RE, function (m) {
      out.weeks = out.weeks ? out.weeks + ' ' + m : m;
      return ' ';
    });

    var tm = s.match(TEACHER_RE);
    if (tm) {
      if (!out.teacher) out.teacher = tm[0];
      s = s.replace(tm[0], ' ');
    }

    for (var i = 0; i < LOC_RES.length; i++) {
      var m = s.match(LOC_RES[i]);
      if (m && m[0] && m[0].length >= 2) {
        var loc = tidy(m[0]);
        // 「机房」+「A203」这类拆开的地点拼起来
        if (out.location.indexOf(loc) < 0) {
          out.location = out.location ? out.location + loc : loc;
        }
        s = s.replace(m[0], ' ');
      }
    }

    s = tidy(s);
    if (!s) return;

    // 已有课程名后，短汉字片段大概率是老师姓名
    if (!out.teacher && names.length &&
        /^[\u4e00-\u9fa5·]{2,4}$/.test(s) &&
        !/^(必修|选修|公选|限选|任选|理论|实验|实践|考试|考查|专业课|公共课|基础课)/.test(s)) {
      out.teacher = s;
      return;
    }

    if (s.length >= 2 || !names.length) names.push(s);
    else notes.push(s);
  }

  /**
   * 把一格文字拆成 { name, location, teacher, weeks, note }
   * 支持：「高等数学\n教三301\n张老师」「大学英语(教三-301)(1-16周)」
   */

  /* ==========================================================
   * 高校课程专业词库与模糊纠偏 (Curriculum Dictionary & Fuzzy Correction)
   * 针对本地 Tesseract chi_sim 常见形近字误识（如 高散数学→高等数学、微积今→微积分）
   * ========================================================== */
  var COURSE_DICT = [
    '高等数学', '微积分', '线性代数', '概率论与数理统计', '概率论', '数理统计', '离散数学', '复变函数与积分变换',
    '复变函数', '数学建模', '数值分析', '计算方法', '常微分方程', '偏微分方程', '数学分析', '高等代数', '抽象代数',
    '实变函数', '泛函分析', '拓扑学', '运筹学', '最优化方法', '应用统计',
    '大学物理', '大学物理实验', '普通物理', '理论力学', '材料力学', '结构力学', '流体力学', '弹性力学', '工程力学',
    '电动力学', '热力学与统计物理', '量子力学', '固体物理', '光学', '原子物理学',
    '大学英语', '综合英语', '英语听说', '英语视听说', '英语写作', '英语阅读', '学术英语', '科技英语', '大学日语', '大学德语', '大学法语',
    '程序设计基础', 'C语言程序设计', 'Python程序设计', 'Java程序设计', '面向对象程序设计', '高级语言程序设计',
    '数据结构', '数据结构与算法', '算法设计与分析', '操作系统', '计算机网络', '计算机组成原理', '计算机体系结构',
    '数据库系统原理', '数据库原理及应用', '软件工程', '编译原理', '人工智能', '人工智能导论', '机器学习', '深度学习',
    '数字图像处理', '计算机图形学', '计算机视觉', '自然语言处理', '数据挖掘', '大数据技术', '云计算技术',
    '网络安全', '信息安全概论', '密码学', '嵌入式系统', '单片机原理及应用', '微机原理与接口技术', '汇编语言',
    '数字逻辑', '数字电路与逻辑设计', '模拟电子技术', '数字电子技术', '电路原理', '电路分析', '电路分析基础',
    '信号与系统', '数字信号处理', '自动控制原理', '现代控制理论', '通信原理', '电磁场与电磁波', '高频电子线路',
    '传感器与检测技术', '电机与拖动', '电力电子技术', '工程制图', '机械制图', '画法几何及机械制图', '机械设计基础',
    '机械原理', '互换性与测量技术', '工程材料', '金工实习', '电子工艺实习', '电工电子实习',
    '无机化学', '有机化学', '分析化学', '物理化学', '生物化学', '仪器分析', '化工原理', '高分子化学', '普通生物学',
    '分子生物学', '细胞生物学', '遗传学', '微生物学', '生理学', '解剖学', '病理学', '药理学', '医学统计学',
    '马克思主义基本原理', '毛泽东思想和中国特色社会主义理论体系概论', '习近平新时代中国特色社会主义思想概论',
    '思想道德与法治', '思想道德修养与法律基础', '中国近现代史纲要', '形势与政策', '军事理论', '军事技能',
    '大学生心理健康教育', '大学生职业生涯规划', '就业指导', '创新创业基础', '劳动教育',
    '大学体育', '体育', '羽毛球', '篮球', '排球', '足球', '乒乓球', '网球', '太极拳', '健美操', '游泳',
    '微观经济学', '宏观经济学', '政治经济学', '计量经济学', '金融学', '货币银行学', '国际经济学', '国际贸易实务',
    '财政学', '统计学', '管理学', '管理学原理', '会计学', '基础会计', '中级财务会计', '财务管理', '市场营销学',
    '组织行为学', '人力资源管理', '战略管理', '运营管理', '经济法', '民法总论', '刑法学', '宪法学', '行政法与行政诉讼法',
    '大学语文', '中国古代文学', '中国现当代文学', '外国文学', '传播学概论', '新闻学概论', '教育学原理', '普通心理学'
  ];

  // 高频形近字直接替换表（先做局部词根修复，再做编辑距离对齐）
  var OCR_TYPO_RULES = [
    [/高[散等数筹][数枚字学]学?/g, '高等数学'],
    [/微积[今份兮分]/g, '微积分'],
    [/[线浅][性牲形]代[数枚]/g, '线性代数'],
    [/概[率幸][论沦]/g, '概率论'],
    [/数理统[汁计]/g, '数理统计'],
    [/[大太][学字]英[语捂语]/g, '大学英语'],
    [/[大太][学字]物[理埋]/g, '大学物理'],
    [/[大太][学字]体[育肓]/g, '大学体育'],
    [/体[肓育]/g, '体育'],
    [/数[据椐]结[构抅]/g, '数据结构'],
    [/操[作怍]系[统統]/g, '操作系统'],
    [/[计汁][算箅][机饥]网[络絡]/g, '计算机网络'],
    [/[计汁][算箅][机饥]组成原[理埋]/g, '计算机组成原理'],
    [/离[散撤][数枚]学/g, '离散数学'],
    [/编译原[理埋]/g, '编译原理'],
    [/软件工[程呈]/g, '软件工程'],
    [/马[克兑]思主[义乂]/g, '马克思主义'],
    [/毛[泽择][东乐]/g, '毛泽东'],
    [/思想道[德徳]/g, '思想道德'],
    [/近现代[史吏]纲要/g, '近现代史纲要'],
    [/形[势努]与政[策笨]/g, '形势与政策'],
    [/模[拟似]电子技术/g, '模拟电子技术'],
    [/数字电子技[术木]/g, '数字电子技术'],
    [/信[号亏]与系统/g, '信号与系统']
  ];

  // 反义/姊妹学科保护对：这几组词虽然只差 1 个字，但绝不能互相纠偏
  var DISTINCT_PREFIXES = ['微观', '宏观', '无机', '有机', '分析', '物理', '生物', '模拟', '数字', '常微', '偏微', '实变', '复变', '古代', '现代'];

  function editDistance(a, b) {
    var m = a.length, n = b.length;
    var dp = [];
    for (var i = 0; i <= m; i++) {
      dp[i] = [i];
      for (var j = 1; j <= n; j++) {
        dp[i][j] = i === 0 ? j : 0;
      }
    }
    for (var r = 1; r <= m; r++) {
      for (var c = 1; c <= n; c++) {
        if (a.charAt(r - 1) === b.charAt(c - 1)) dp[r][c] = dp[r - 1][c - 1];
        else dp[r][c] = 1 + Math.min(dp[r - 1][c], dp[r][c - 1], dp[r - 1][c - 1]);
      }
    }
    return dp[m][n];
  }

  /**
   * 对识别出的课程名进行高校专业词库纠偏
   * @returns {{ name: string, corrected: boolean, original: string }}
   */
  function correctCourseName(rawName) {
    var orig = String(rawName || '').trim();
    if (!orig) return { name: '', corrected: false, original: '' };

    var fixed = orig;
    for (var i = 0; i < OCR_TYPO_RULES.length; i++) {
      fixed = fixed.replace(OCR_TYPO_RULES[i][0], OCR_TYPO_RULES[i][1]);
    }
    if (fixed !== orig) {
      return { name: fixed, corrected: true, original: orig };
    }

    // 剥离尾部常见编号后缀（如 A / B / (上) / （二） / II / 实验）后再比对词干
    var suffixMatch = /^([一-龥A-Za-z]{3,14}?)(\s*(?:[A-Da-d1-4ⅠⅡⅢⅣ]+|[（(][上下一二三四1-4A-D][)）]|实验|实践|上|下)?)$/.exec(orig);
    var stem = suffixMatch ? suffixMatch[1] : orig;
    var tail = suffixMatch ? (suffixMatch[2] || '') : '';

    if (COURSE_DICT.indexOf(stem) >= 0) {
      return { name: orig, corrected: false, original: orig };
    }

    // 若词干长度 >= 3，查找编辑距离为 1 的同长度标准课程名
    if (stem.length >= 3) {
      for (var d = 0; d < COURSE_DICT.length; d++) {
        var cand = COURSE_DICT[d];
        if (cand.length !== stem.length) continue;
        if (editDistance(stem, cand) === 1) {
          // 检查是否触碰反义前缀保护对（如 微观经济学 vs 宏观经济学）
          var conflict = false;
          for (var p = 0; p < DISTINCT_PREFIXES.length; p++) {
            var pfx = DISTINCT_PREFIXES[p];
            if ((stem.indexOf(pfx) === 0 && cand.indexOf(pfx) !== 0) ||
                (cand.indexOf(pfx) === 0 && stem.indexOf(pfx) !== 0)) {
              conflict = true;
              break;
            }
          }
          if (!conflict) {
            return { name: cand + tail, corrected: true, original: orig };
          }
        }
      }
    }

    return { name: orig, corrected: false, original: orig };
  }

  function parseCell(text) {
    var raw = String(text || '');
    var lines = raw.split(/[\n\r]+|\s+\/\s+/).map(function (s) { return s.trim(); }).filter(Boolean);
    var out = { name: '', location: '', teacher: '', weeks: '', note: '', raw: raw };
    if (!lines.length) return out;

    var names = [], notes = [];
    lines.forEach(function (line) {
      // 括号里的内容单独当一段处理（课表常把地点/周次放括号里）
      var segs = [];
      var main = String(line).replace(/[（(]([^（）()]*)[）)]/g, function (m, inner) {
        if (inner.trim()) segs.push(inner.trim());
        return ' ';
      });
      if (main.trim()) segs.unshift(main.trim());
      segs.forEach(function (seg) { takeFields(seg, out, names, notes); });
    });

    var rawTitle = tidyName(names.length ? names[0] : (lines[0] || ''));
    var corr = correctCourseName(rawTitle);
    out.name = corr.name;
    if (corr.corrected) out.correctedFrom = corr.original;
    out.note = tidy(notes.join(' '));
    return out;
  }

  /** 兼容旧接口：只返回前三项 */
  function splitCell(text) {
    var p = parseCell(text);
    if (!p.name) return null;
    return { name: p.name, location: p.location, teacher: p.teacher };
  }

  /** 周次文本 → { weekType, startWeek, endWeek } */
  function parseWeeks(text, totalWeeks) {
    var s = String(text || '').trim();
    if (!s) return null;
    var tot = totalWeeks || 20;
    var isOdd = /单周|\(单\)|（单）/.test(s);
    var isEven = /双周|\(双\)|（双）/.test(s);
    var wType = isOdd ? 'odd' : isEven ? 'even' : 'all';

    var m = s.match(/(\d{1,2})\s*[-~—－至]\s*(\d{1,2})/);
    if (m) {
      var a = Math.max(1, parseInt(m[1], 10));
      var b = Math.max(a, parseInt(m[2], 10));
      return { weekType: wType, startWeek: a, endWeek: b };
    }
    if (isOdd) return { weekType: 'odd', startWeek: 1, endWeek: tot };
    if (isEven) return { weekType: 'even', startWeek: 1, endWeek: tot };
    var one = s.match(/(\d{1,2})\s*周/);
    if (one) {
      var w = parseInt(one[1], 10);
      return { weekType: 'all', startWeek: w, endWeek: w };
    }
    return null;
  }
  /* ==========================================================
   * 云端识别（OpenAI 兼容视觉接口）
   * ========================================================== */
  function fileToDataURL(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  /** 调一次视觉接口，返回模型吐出的 JSON 对象（两个业务各自取字段） */
  function visionJSON(file, cfg, prompt) {
    cfg = cfg || {};
    if (!cfg.endpoint || !cfg.apiKey) {
      return Promise.reject(new Error('还没填写云端识别的接口地址与 API Key'));
    }
    return fileToDataURL(file).then(function (dataUrl) {
      return fetch(cfg.endpoint.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + cfg.apiKey
        },
        body: JSON.stringify({
          model: cfg.model || 'gpt-4o-mini',
          temperature: 0,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: dataUrl } }
            ]
          }]
        })
      }).then(function (res) {
        if (!res.ok) throw new Error('接口返回 ' + res.status);
        return res.json();
      }).then(function (json) {
        var content = json.choices && json.choices[0] && json.choices[0].message
          ? json.choices[0].message.content : '';
        var m = String(content).match(/\{[\s\S]*\}/);
        if (!m) throw new Error('返回内容不是有效 JSON');
        return JSON.parse(m[0]);
      });
    });
  }

  function recognizeCloud(file, cfg) {
    var prompt = '你是一个高校教务系统课表结构化提取专家。请从这张课程表图片中提取所有课程安排。\n' +
      '【核心提取规则】：\n' +
      '1. 严格忽略表头与行列坐标文字（星期一至周日、第1-12节、08:00-09:40、上午/下午/晚上等绝不能当成课程）。\n' +
      '2. 连堂课合并：若某门课纵向跨越多节（如第1-2节或第3-4节合并单元格），请将 start 设为起始节次序号，end 设为结束节次序号（整数 1-14）。\n' +
      '3. 同格多课拆分：若同一个格子里上下写了两门不同周次的课（例如单周上A课、双周上B课，或1-8周上A、9-16周上B），必须拆成两条独立的课程记录！\n' +
      '4. 字段剥离：name 只保留纯净课程名称（并自动修正明显错别字）；location 提取教学楼/教室/机房编号（如“教三-301”“理教204”）；teacher 提取任课教师姓名（去掉“老师/教授”后缀或保留原名）；weeks 提取周次描述（如“1-16周”“1-15周(单)”“2-16周(双)”）。\n' +
      '5. 只返回严格合法的 JSON，格式为：{"courses":[{"day":1,"start":1,"end":2,"name":"高等数学A","location":"教三301","teacher":"王敏","weeks":"1-16周"}]}。day 取值 1(周一) 至 7(周日)。不要输出任何解释或 Markdown 代码块包裹以外的文字。';
    return visionJSON(file, cfg, prompt).then(function (data) {
      return (data.courses || []).map(function (c) {
        if (c && c.name) {
          var corr = correctCourseName(String(c.name).trim());
          c.name = corr.name;
          if (corr.corrected) c.correctedFrom = corr.original;
        }
        return c;
      });
    });
  }

  /**
   * 从活动页 / 通知截图里抽取待办
   * @param {File} file
   * @param {object} cfg 与课表识别共用「设置 → 图片识别」的接口配置
   * @param {string} today 今天的 YYYY-MM-DD，用来让模型把「明天/下周三」换算成绝对日期
   */
  function recognizeCloudTasks(file, cfg, today) {
    var prompt = '这是一张活动页、通知或待办清单的截图。请把其中所有需要执行的事项提取成待办。\n' +
      '必须忽略界面元素：状态栏（时间、电量、信号）、返回/分享/预览/复制/更多一类的按钮、' +
      '广告与推广语、昵称与头像文字、点赞评论转发数、底部导航、纯标题大字。\n' +
      '要提取的是：报名/投稿/提交材料/参加活动/开会/上课/交作业/缴费/截止日期这类可执行的事。\n' +
      '今天日期是 ' + (today || '') + '。相对日期（明天、下周三、本周五）要换算成 YYYY-MM-DD；' +
      '没有明确日期或时间就留空字符串，不要猜。\n' +
      '返回 JSON：{"tasks":[{"title":"以动词或名词短语开头的短标题，不含日期时间地点",' +
      '"dueDate":"YYYY-MM-DD","dueTime":"HH:MM","note":"地点或补充说明","priority":"normal|high"}]}。\n' +
      '同一件事不要拆成多条。只返回 JSON，不要解释。';
    return visionJSON(file, cfg, prompt).then(function (data) {
      return Array.isArray(data.tasks) ? data.tasks : [];
    });
  }

  /** 睡眠截图走云端视觉：直接让多模态大模型读整张图，返回结构化 JSON */
  function toInt(v) {
    if (v == null) return null;
    var n = parseInt(String(v).replace(/[^\d-]/g, ''), 10);
    return isNaN(n) ? null : n;
  }

  function recognizeCloudSleep(file, cfg) {
    var prompt = '这是小米运动健康（或类似健康 App）的睡眠详情页截图。请提取这一晚的睡眠数据，'
      + '只返回 JSON：{"date":"入睡日期 YYYY-MM-DD","start":"入睡时间 HH:MM","end":"醒来时间 HH:MM",'
      + '"totalMinutes":总睡眠分钟数,"deep":深睡分钟数,"light":浅睡分钟数,"rem":快速眼动(REM)分钟数,'
      + '"awake":清醒分钟数,"efficiency":睡眠效率百分比(整数),"awakenings":清醒次数(整数),'
      + '"quality":"good|normal|bad"}。'
      + '各阶段优先用截图里直接给出的分钟数（例如“2小时4分钟”=124、“1小时”=60）；若只给百分比，'
      + '则用 总睡眠×百分比 推算。截图里没有的字段填空或0。不要解释，只返回 JSON。';
    return visionJSON(file, cfg, prompt).then(function (data) {
      if (!data || typeof data !== 'object') return null;
      var rec = {
        date: (data.date || '').toString().replace(/\s/g, ''),
        start: (data.start || '').toString().replace(/\s/g, ''),
        end: (data.end || '').toString().replace(/\s/g, ''),
        total: toInt(data.totalMinutes),
        deep: toInt(data.deep),
        light: toInt(data.light),
        rem: toInt(data.rem),
        awake: toInt(data.awake),
        efficiency: toInt(data.efficiency),
        awakenings: toInt(data.awakenings),
        quality: ['good', 'normal', 'bad'].indexOf(data.quality) >= 0 ? data.quality
          : (data.efficiency != null && data.efficiency >= 90) ? 'good'
          : (data.efficiency != null && data.efficiency < 75) ? 'bad' : 'normal',
        source: 'cloud'
      };
      if (!rec.date && !rec.start && !rec.end && rec.total == null) return null;
      return rec;
    });
  }

  global.Ocr = {
    recognizeLocal: recognizeLocal,
    recognizeCloud: recognizeCloud,
    recognizeCloudTasks: recognizeCloudTasks,
    recognizeCloudSleep: recognizeCloudSleep,
    binarize: binarize,
    enhance: enhance,
    preprocessCanvas: preprocessCanvas,
    normalizeImage: normalizeImage,
    rotateCanvas: rotateCanvas,
    solveHomography: solveHomography,
    warpPerspective: warpPerspective,
    detectCorners: detectCorners,
    detectLines: detectLines,
    stripColorCardBg: stripColorCardBg,
    isolateGridLines: isolateGridLines,
    buildGrid: buildGrid,
    buildFromLines: buildFromLines,
    gridToItems: gridToItems,
    confLevel: confLevel,
    confAt: confAt,
    confStats: confStats,
    CONF_LOW: CONF_LOW,
    CONF_MID: CONF_MID,
    parseCell: parseCell,
    parseWeeks: parseWeeks,
    splitCell: splitCell,
    correctCourseName: correctCourseName,
    COURSE_DICT: COURSE_DICT,
    isHeaderWord: function (t) {
      return !!dayOf(t) || !!periodOf(t) || isTime(t) || isMeta(t);
    },
    defaultCols: defaultCols
  };
})(window);


