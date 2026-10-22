

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
  function enhance(canvas) {
    var w = canvas.width, h = canvas.height;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var img;
    try { img = ctx.getImageData(0, 0, w, h); } catch (e) { return canvas; }
    var d = img.data, n = w * h;

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
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  /**
   * 兜底用：分块自适应二值化（对比度极低的图才有优势，硬二值会断笔画）
   */
  function binarize(canvas) {
    var w = canvas.width, h = canvas.height;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var img;
    try { img = ctx.getImageData(0, 0, w, h); } catch (e) { return canvas; }
    var d = img.data;
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
    ctx.putImageData(img, 0, 0);
    canvas._binary = true;
    return canvas;
  }

  /** 检测表格的横竖线（像素统计），返回 {vlines, hlines} */
  function detectLines(canvas) {
    var w = canvas.width, h = canvas.height;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var data;
    try {
      data = ctx.getImageData(0, 0, w, h).data;
    } catch (e) {
      return { vlines: [], hlines: [] };
    }

    var dark = new Uint8Array(w * h);
    for (var i = 0; i < w * h; i++) {
      var r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      dark[i] = (0.299 * r + 0.587 * g + 0.114 * b) < (canvas._binary ? 128 : 150) ? 1 : 0;
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

  /** 单次识别：增强图 → Tesseract（返回原始结果） */
  function recognizeOnce(file, opts, onProgress) {
    opts = opts || {};
    var norm;
    return normalizeImage(file).then(function (n) {
      norm = n;
      if (opts.binary) binarize(n.canvas);
      else enhance(n.canvas);
      return new Promise(function (resolve) {
        n.canvas.toBlob(function (b) { norm.blob = b; resolve(); }, 'image/png');
      });
    }).then(function () {
      if (onProgress) onProgress({ status: '正在分析表格结构…', progress: 0.05 });
      var lines = detectLines(norm.canvas);
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
  function recognizeLocal(file, onProgress) {
    return recognizeOnce(file, { psm: '4' }, onProgress).then(function (first) {
      if (first.words.length >= 12 || first.words.length === 0) return first;
      // 词太少：改用二值化 + 稀疏文本模式再试一次
      if (onProgress) onProgress({ status: '换个方式再识别一次…', progress: 0.5 });
      return recognizeOnce(file, { psm: '11', binary: true }, onProgress).then(function (second) {
        return second.words.length > first.words.length ? second : first;
      }).catch(function () { return first; });
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
      return { cols: defaultCols(), rows: [], cells: [] };
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

    var out = cells.map(function (row) { return row.map(joinCell); });

    // 尾部整行都空就丢掉
    while (rows.length && out[out.length - 1].every(function (t) { return !t; })) {
      rows.pop(); out.pop();
    }

    return {
      cols: cols, rows: rows, cells: out,
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
        text: w.text, cx: w.cx, cy: w.cy, x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1,
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

    var cells = buckets.map(function (row) { return row.map(joinCell); });
    var rows = rowRanges.map(function (r, i) {
      return { y: (r.y0 + r.y1) / 2, label: '第 ' + (i + 1) + ' 节', periodIndex: i + 1, index: i };
    });
    while (rows.length && cells[cells.length - 1].every(function (t) { return !t; })) {
      rows.pop(); cells.pop();
    }
    return { cols: colRanges, rows: rows, cells: cells };
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
    // 明理教学楼 / 实验楼 / 图书馆 / 体育馆 / 机房…
    new RegExp('[' + CN + 'A-Za-z]{0,6}(?:教学楼|实验楼|办公楼|综合楼|图书馆|体育馆|体育中心|机房|实验室|报告厅|阶梯教室|多媒体教室|会议室|操场|篮球场|风雨操场)'),
    // 教三-301 / 逸夫馆A201 / 三教301 / 教=301（「三」常被认成 =）
    /[东南西北]?[一二三四五六七八九十\d]?\s?[教馆厅室房]\s*[一二三四五六七八九十]?\s*[-—－=＝]?\s*[A-Za-z]{0,2}\s?\d{2,4}/,
    // 明理楼 302 / 逸夫馆A201 / 一教 101
    new RegExp('[' + CN + ']{1,5}[楼馆厅堂]\\s?[-—]?\\s?[A-Za-z]{0,2}\\s?\\d{2,4}'),
    // A101 / B-302 / N 201
    /\b[A-Za-z]{1,3}\s?[-—]?\s?\d{2,4}\b/,
    // 3号楼 / 201室
    /\d{1,3}\s?[号楼室]/
  ];

  var TEACHER_RE = new RegExp('[' + CN + ']{2,4}(?:老师|教授|讲师|副教授|助教)');

  var WEEK_RE = /\d{1,2}\s*[-~—－至]\s*\d{1,2}\s*周?|\d{1,2}\s*周|单周|双周|全周|前\s*\d{1,2}\s*周|后\s*\d{1,2}\s*周/g;

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

    out.name = tidyName(names.length ? names[0] : (lines[0] || ''));
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
    var s = String(text || '');
    if (!s) return null;
    if (/单周/.test(s)) return { weekType: 'odd', startWeek: 1, endWeek: totalWeeks || 20 };
    if (/双周/.test(s)) return { weekType: 'even', startWeek: 1, endWeek: totalWeeks || 20 };
    var m = s.match(/(\d{1,2})\s*[-~—－至]\s*(\d{1,2})/);
    if (m) {
      var a = Math.max(1, parseInt(m[1], 10));
      var b = Math.max(a, parseInt(m[2], 10));
      return { weekType: 'all', startWeek: a, endWeek: b };
    }
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

  function recognizeCloud(file, cfg) {
    cfg = cfg || {};
    if (!cfg.endpoint || !cfg.apiKey) {
      return Promise.reject(new Error('还没填写云端识别的接口地址与 API Key'));
    }
    return fileToDataURL(file).then(function (dataUrl) {
      var prompt = '这是一张课程表截图。请只提取课程格子里的内容，' +
        '忽略表头行（星期几、时间、节次、课程、教室这类表头文字），也不要把表头当课程。' +
        '返回 JSON：{"courses":[{"day":1-7,"start":节次,"end":节次,' +
        '"name":"课程名","location":"上课地点","teacher":"教师","weeks":"周次"}]}。' +
        'day 用 1=周一 … 7=周日；start/end 是占用的节次序号（表格第几行就是第几节，连上的课写区间）。' +
        '课程名里不要包含地点、教师和周次，这三项分别放到对应字段；没有的留空字符串。只返回 JSON，不要解释。';

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
        var data = JSON.parse(m[0]);
        return data.courses || [];
      });
    });
  }

  global.Ocr = {
    recognizeLocal: recognizeLocal,
    recognizeCloud: recognizeCloud,
    binarize: binarize,
    normalizeImage: normalizeImage,
    buildGrid: buildGrid,
    buildFromLines: buildFromLines,
    parseCell: parseCell,
    parseWeeks: parseWeeks,
    splitCell: splitCell,
    isHeaderWord: function (t) {
      return !!dayOf(t) || !!periodOf(t) || isTime(t) || isMeta(t);
    },
    defaultCols: defaultCols
  };
})(window);


