/* ==========================================================
 * 课表导出图片
 *
 * 为什么不用 html2canvas：
 *   多引 40KB，且它靠 SVG <foreignObject> 把 DOM 塞进 Canvas，
 *   中文字体、color-mix() 渐变、border-radius 经常渲染崩掉。
 *   我们的布局其实已经有现成指令——课表渲染时算出的 renderAt
 *   （block 合并连堂 / stack 同格堆叠），直接按它在 Canvas 上画就行。
 *
 * 三个必须处理的坑：
 *   1. devicePixelRatio：不乘缩放，导出的图在高分屏上看是糊的
 *   2. Canvas 不会自动换行：课程名/地点要自己按宽度拆行
 *   3. 单双周课程：只画「当前周」的，不把两种周次叠在一起
 *
 * 布局计算（layout）与绘制（paint）分离：
 *   layout 是纯函数，只吃数据吐坐标，可以单测；
 *   paint 才碰 Canvas。
 * ========================================================== */
(function (global) {
  'use strict';

  var DEFAULT_OPTS = {
    cellW: 132,        // 每天一列的宽度（逻辑像素）
    headH: 62,         // 表头高度
    timeW: 62,         // 左侧节次列宽
    rowH: 68,          // 每节课的行高
    pad: 22,           // 画布四周留白
    scale: 2,          // 导出倍率（devicePixelRatio 或更高）
    title: true,       // 是否画标题（学期 + 第 N 周）
    dateInHead: true   // 表头是否显示日期
  };

  /* ---------- 纯函数：文本按宽度拆行 ---------- */
  /**
   * 把文本按给定宽度拆成多行，超出 maxLines 时末行加省略号。
   * 逐字符测量——中文没有空格可断，只能一字一字量。
   * @param {CanvasRenderingContext2D} ctx 需要一个 measureText 的上下文
   */
  function wrapText(ctx, text, maxWidth, maxLines) {
    if (!text) return [];
    maxLines = maxLines || 3;
    var lines = [];
    var cur = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (ch === '\n') {
        lines.push(cur);
        cur = '';
        if (lines.length >= maxLines) break;
        continue;
      }
      var test = cur + ch;
      if (ctx.measureText(test).width > maxWidth && cur) {
        lines.push(cur);
        cur = ch;
        if (lines.length >= maxLines) { cur = ''; break; }
      } else {
        cur = test;
      }
    }
    if (cur && lines.length < maxLines) lines.push(cur);

    // 被截断时，末行加省略号并收缩到放得下
    if (lines.length >= maxLines) {
      var rest = false;
      // 判断是否真的还有剩余内容
      var consumed = lines.join('').length;
      if (consumed < text.replace(/\n/g, '').length) rest = true;
      if (rest) {
        var last = lines[maxLines - 1];
        while (last.length > 1 && ctx.measureText(last + '…').width > maxWidth) {
          last = last.slice(0, -1);
        }
        lines[maxLines - 1] = last + '…';
      }
    }
    return lines;
  }

  /**
   * 计算整张图的逻辑尺寸。
   * @param {number} days 列数（7）
   * @param {number} rows 行数（节次数）
   */
  function measure(days, rows, opts) {
    var o = Object.assign({}, DEFAULT_OPTS, opts || {});
    var w = o.pad * 2 + o.timeW + o.cellW * days;
    var h = o.pad * 2 + (o.title ? 46 : 0) + o.headH + o.rowH * rows;
    return { w: w, h: h, opts: o };
  }

  /* ---------- 颜色工具 ---------- */
  function hexToRgb(hex) {
    if (!hex) return [79, 70, 229];
    var s = String(hex).replace('#', '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    var n = parseInt(s, 16);
    if (isNaN(n)) return [79, 70, 229];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /** 把颜色与白色按 alpha 混合，模拟 CSS 的 color-mix(in srgb, c 11%, #fff) */
  function tint(hex, alpha, bg) {
    var c = hexToRgb(hex);
    var b = bg || [255, 255, 255];
    return 'rgb(' +
      Math.round(c[0] * alpha + b[0] * (1 - alpha)) + ',' +
      Math.round(c[1] * alpha + b[1] * (1 - alpha)) + ',' +
      Math.round(c[2] * alpha + b[2] * (1 - alpha)) + ')';
  }

  /** 圆角矩形路径（Safari 老版本没有 roundRect，自己画） */
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------- 主绘制 ---------- */
  /**
   * 画课表。
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} data
   *   { days: [{ label:'周一', date:'10.20', today:bool }],
   *     rows: [{ name:'1', start:'08:00', end:'08:45', groupSep:bool }],
   *     cells: { 'day|row': { type:'block'|'stack', span, items:[{name,loc,color,teacher}] } },
   *     title: '2025 秋 · 第 6 周',
   *     theme: { bg, surface, line, text, text2, text3, primary } }
   * @param {object} opts
   */
  function paint(ctx, data, opts) {
    var m = measure(data.days.length, data.rows.length, opts);
    var o = m.opts;
    var T = data.theme || {};
    var bg = T.bg || '#f4f5f9';
    var surface = T.surface || '#ffffff';
    var line = T.line || '#e8eaf0';
    var text = T.text || '#1c1f2b';
    var text2 = T.text2 || '#5c6274';
    var text3 = T.text3 || '#969aab';
    var primary = T.primary || '#4f46e5';

    var W = m.w, H = m.h;

    /* 背景 */
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    var x0 = o.pad;
    var y0 = o.pad;

    /* 标题 */
    if (o.title && data.title) {
      ctx.fillStyle = text;
      ctx.font = '600 17px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(data.title, x0, y0 + 20);
      y0 += 46;
    }

    var gridX = x0 + o.timeW;
    var gridY = y0 + o.headH;
    var gridW = o.cellW * data.days.length;
    var gridH = o.rowH * data.rows.length;

    /* 表头底 */
    ctx.fillStyle = surface;
    roundRect(ctx, x0, y0, o.timeW + gridW, o.headH, 12);
    ctx.fill();

    /* 表头：星期 + 日期 */
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    data.days.forEach(function (d, i) {
      var cx = gridX + o.cellW * i + o.cellW / 2;
      var cy = y0 + o.headH / 2;
      if (d.today) {
        ctx.fillStyle = primary;
        roundRect(ctx, cx - 26, cy - 19, 52, 38, 10);
        ctx.fill();
        ctx.fillStyle = '#fff';
      } else {
        ctx.fillStyle = text2;
      }
      ctx.font = '600 12.5px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(d.label, cx, cy - (o.dateInHead && d.date ? 7 : 0));
      if (o.dateInHead && d.date) {
        ctx.fillStyle = d.today ? 'rgba(255,255,255,.82)' : text3;
        ctx.font = '500 10.5px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillText(d.date, cx, cy + 8);
      }
    });

    /* 表头底边线 */
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + o.headH);
    ctx.lineTo(x0 + o.timeW + gridW, y0 + o.headH);
    ctx.stroke();

    /* 网格底 */
    ctx.fillStyle = surface;
    ctx.fillRect(gridX, gridY, gridW, gridH);

    /* 节次列底 */
    ctx.fillStyle = surface;
    ctx.fillRect(x0, gridY, o.timeW, gridH);

    /* 节次文字 */
    data.rows.forEach(function (r, i) {
      var ry = gridY + o.rowH * i;

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = text2;
      ctx.font = '600 11.5px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      var hasTime = !!(r.start || r.end);
      var cyc = ry + o.rowH / 2;
      if (hasTime) {
        ctx.fillText(r.name, x0 + o.timeW / 2, cyc - 12);
        ctx.fillStyle = text3;
        ctx.font = '500 10.5px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillText(r.start || '', x0 + o.timeW / 2, cyc);
        ctx.fillText(r.end || '', x0 + o.timeW / 2, cyc + 12);
      } else {
        ctx.fillText(r.name, x0 + o.timeW / 2, cyc);
      }
    });

    /* 横向分隔线：贯穿节次列 + 网格 */
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    data.rows.forEach(function (r, i) {
      var ry = gridY + o.rowH * (i + 1);
      ctx.beginPath();
      ctx.moveTo(x0, ry);
      ctx.lineTo(x0 + o.timeW + gridW, ry);
      ctx.stroke();
    });

    /* 纵向分隔线（含节次列与网格的边界） */
    for (var c = 0; c <= data.days.length; c++) {
      var vx = gridX + o.cellW * c;
      ctx.beginPath();
      ctx.moveTo(vx, y0 + o.headH);
      ctx.lineTo(vx, gridY + gridH);
      ctx.stroke();
    }

    /* 外框：圆角描一圈，让整体收口 */
    ctx.strokeStyle = line;
    roundRect(ctx, x0, y0, o.timeW + gridW, o.headH + gridH, 12);
    ctx.stroke();

    /* 课程块 */
    data.days.forEach(function (d, di) {
      data.rows.forEach(function (r, ri) {
        var cell = data.cells[di + '|' + ri];
        if (!cell) return;
        var cx = gridX + o.cellW * di;
        var cy = gridY + o.rowH * ri;

        if (cell.type === 'block') {
          var bh = o.rowH * (cell.span || 1);
          drawBlock(ctx, cx, cy, o.cellW, bh, cell.item, T);
        } else if (cell.type === 'stack') {
          var items = cell.items;
          var gap = 3;
          var each = (o.rowH - gap * (items.length - 1)) / items.length;
          items.forEach(function (it, k) {
            drawBlock(ctx, cx, cy + (each + gap) * k, o.cellW, each, it, T);
          });
        }
      });
    });
  }

  /** 画单个课程块：左侧色条 + 淡色底 + 课程名 + 地点/老师 */
  function drawBlock(ctx, x, y, w, h, item, T) {
    var PAD = 4;
    var bx = x + PAD, by = y + PAD, bw = w - PAD * 2, bh = h - PAD * 2;
    if (bw <= 4 || bh <= 4) return;

    var color = item.color || (T && T.primary) || '#4f46e5';
    var surface = (T && T.surface) || '#ffffff';

    // 底：色 11% + 白
    ctx.fillStyle = tint(color, 0.11, hexToRgb(surface));
    roundRect(ctx, bx, by, bw, bh, 9);
    ctx.fill();

    // 左侧 4px 色条：先填满整个圆角，再在其上盖一层淡底，留下左侧那一条
    ctx.save();
    roundRect(ctx, bx, by, bw, bh, 9);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = tint(color, 0.11, hexToRgb(surface));
    ctx.fillRect(bx + 4, by, bw - 4, bh);
    ctx.restore();

    var innerX = bx + 4 + 7;
    var innerW = bw - 4 - 14;
    var innerY = by + 6;
    var maxY = by + bh - 5;

    /* 矮块（撞课堆叠后每块只有二十来像素）：名字和信息压成一行 */
    if (bh < 44) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      var metaShort = [];
      if (item.location) metaShort.push(item.location);
      var oneLine = (item.name || '') + (metaShort.length ? ' · ' + metaShort[0] : '');
      ctx.fillStyle = color;
      ctx.font = '650 12px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      var ln = wrapText(ctx, oneLine, innerW, 1)[0] || '';
      if (ln) ctx.fillText(ln, innerX, by + bh / 2);
      return;
    }

    // 课程名（最多 2 行）
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = color;
    ctx.font = '650 12.5px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    var nameLines = wrapText(ctx, item.name || '', innerW, bh > 40 ? 2 : 1);
    nameLines.forEach(function (ln, i) {
      if (innerY + 13 > maxY) return;
      ctx.fillText(ln, innerX, innerY);
      innerY += 16;
    });

    // 第二行信息：地点 / 老师（放得下才画）
    var meta = [];
    if (item.location) meta.push(item.location);
    if (item.teacher) meta.push(item.teacher);
    if (!meta.length) return;
    if (innerY + 11 > maxY) return;

    ctx.fillStyle = (T && T.text2) || '#5c6274';
    ctx.font = '500 10.5px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    var metaLine = wrapText(ctx, meta.join(' · '), innerW, 1)[0] || '';
    if (metaLine) ctx.fillText(metaLine, innerX, innerY);
  }

  /* ---------- 从当前页面采集数据 ---------- */
  /**
   * 把课表视图当前的 renderAt 指令转成 paint 能吃的数据。
   * 注意：只取「当前周」的课程，单双周不会叠加。
   */
  function collect(weekNo) {
    var days = [];
    var todayStr = DateUtil.toStr(DateUtil.today());
    // 与课表页保持一致：关掉周末时导出的图也只画 5 天
    var dayCount = Store.settings.showWeekend === false ? 5 : 7;
    for (var d = 1; d <= dayCount; d++) {
      var date = Store.dateOf(weekNo, d);
      days.push({
        label: Store.DAY_NAMES[d - 1],
        date: DateUtil.mdShort(date),
        today: DateUtil.toStr(date) === todayStr
      });
    }

    var rows = Store.periods.map(function (p, i) {
      return { name: p.name, start: p.start || '', end: p.end || '' };
    });

    // 复用课表视图的布局逻辑（同一套规则，保证图和页面长得一样）
    // 注意键的差异：ScheduleLayout 用 'day|row'（day 是 1-7），
    // 这里转成 'di|row'（di 是 0-6），方便按数组下标遍历。
    var cells = {};
    var raw = global.ScheduleLayout ? global.ScheduleLayout.build(weekNo) : {};
    Object.keys(raw).forEach(function (k) {
      var p = k.split('|');
      var di = parseInt(p[0], 10) - 1;
      if (di < 0 || di > 6) return;
      cells[di + '|' + p[1]] = raw[k];
    });

    var sem = Store.semester || {};
    var title = (sem.name ? sem.name + ' · ' : '') + '第 ' + weekNo + ' 周';

    return { days: days, rows: rows, cells: cells, title: title, theme: readTheme() };
  }

  /** 从 :root 读实际生效的主题色，避免 Canvas 里硬编码 */
  function readTheme() {
    var cs = getComputedStyle(document.documentElement);
    function v(name, fb) {
      var x = cs.getPropertyValue(name);
      return (x && x.trim()) || fb;
    }
    return {
      bg: v('--bg', '#f4f5f9'),
      surface: v('--surface', '#ffffff'),
      line: v('--line', '#e8eaf0'),
      text: v('--text', '#1c1f2b'),
      text2: v('--text-2', '#5c6274'),
      text3: v('--text-3', '#969aab'),
      primary: v('--primary', '#4f46e5')
    };
  }

  /* ---------- 导出入口 ---------- */
  /**
   * 生成 PNG 并触发下载。
   * @returns {Promise<{blob, width, height}>}
   */
  function exportPNG(opts) {
    opts = Object.assign({}, DEFAULT_OPTS, opts || {});
    var weekNo = Store.currentWeek();
    var data = collect(weekNo);
    if (!data.rows.length) return Promise.reject(new Error('没有节次数据'));

    // 有没有课
    var has = Object.keys(data.cells).length > 0;
    if (!has) return Promise.reject(new Error('本周没有课程'));

    var m = measure(data.days.length, data.rows.length, opts);

    // devicePixelRatio 兜底：屏幕可能 1x，但导出图至少 2x 才不糊
    var dpr = Math.max(2, Math.min(3, (global.devicePixelRatio || 1)));
    var scale = opts.scale || dpr;

    var cv = document.createElement('canvas');
    cv.width = Math.round(m.w * scale);
    cv.height = Math.round(m.h * scale);

    var ctx = cv.getContext('2d');
    ctx.scale(scale, scale);

    paint(ctx, data, opts);

    return new Promise(function (resolve, reject) {
      cv.toBlob(function (blob) {
        if (!blob) { reject(new Error('图片生成失败')); return; }
        var fname = (Store.semester && Store.semester.name ? Store.semester.name : '课表') +
                    '-第' + weekNo + '周.png';
        downloadBlob(blob, fname);
        resolve({ blob: blob, width: cv.width, height: cv.height, filename: fname });
      }, 'image/png');
    });
  }

  /** 导出课表图片（统一走 SaveFile 保存通道，含复制兜底） */
  function downloadBlob(blob, filename) {
    SaveFile.save(filename, blob, {}).then(function (r) {
      if (r.canceled) { UI.toast('已取消'); return; }
      if (r.method === 'picker' || r.method === 'share') UI.toast('已保存 ' + filename, 'ok');
    }).catch(function (e) { UI.toast('保存失败：' + (e && e.message ? e.message : e), 'err'); });
  }

  /** 预览弹窗：先画出来给人看，再决定下不下载 */
  function previewDialog() {
    var weekNo = Store.currentWeek();
    var data = collect(weekNo);
    if (!data.rows.length || !Object.keys(data.cells).length) {
      UI.toast('本周没有课程，换个周次再试', 'err');
      return;
    }

    var opts = Object.assign({}, DEFAULT_OPTS);
    var m = measure(data.days.length, data.rows.length, opts);
    var dpr = Math.max(2, Math.min(3, (global.devicePixelRatio || 1)));

    var cv = document.createElement('canvas');
    cv.width = Math.round(m.w * dpr);
    cv.height = Math.round(m.h * dpr);
    cv.style.width = '100%';
    cv.style.height = 'auto';
    cv.style.borderRadius = '10px';
    cv.style.border = '1px solid var(--line)';
    var ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    paint(ctx, data, opts);

    var wrap = UI.el('div', { style: { maxHeight: '58vh', overflow: 'auto' } }, [cv]);

    var mdl = UI.modal({
      title: '导出课表图片',
      body: [
        UI.el('div', {
          style: { fontSize: '12px', color: 'var(--text-3)', marginBottom: '10px', lineHeight: '1.6' },
          text: '当前第 ' + weekNo + ' 周 · ' + m.w + '×' + m.h + ' 逻辑像素，导出 ' + dpr + ' 倍图（' +
                cv.width + '×' + cv.height + '）'
        }),
        wrap
      ],
      footer: UI.el('div', { class: 'modal-foot' }, [
        UI.el('button', { class: 'btn', text: '关闭', onclick: function () { mdl.close(); } }),
        UI.el('button', {
          class: 'btn btn-primary', text: '保存 PNG',
          onclick: function () {
            cv.toBlob(function (blob) {
              var fname = (Store.semester && Store.semester.name ? Store.semester.name : '课表') +
                          '-第' + weekNo + '周.png';
              downloadBlob(blob, fname);
              mdl.close();
            }, 'image/png');
          }
        })
      ])
    });
  }

  global.ScheduleExport = {
    DEFAULT_OPTS: DEFAULT_OPTS,
    wrapText: wrapText,
    measure: measure,
    tint: tint,
    hexToRgb: hexToRgb,
    paint: paint,
    collect: collect,
    exportPNG: exportPNG,
    previewDialog: previewDialog
  };
})(window);
