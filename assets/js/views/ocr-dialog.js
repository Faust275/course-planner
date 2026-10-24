/* ==========================================================
 * 导入课表：图片 → 图像预处理(四角透视拉直/辅助对齐网格) → 识别 → 词库纠偏与网格校正 → 写入课程
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;

  var S = null;          // 当前会话状态
  var api = null;
  var bodyEl = null;

  function open() {
    S = {
      step: 'pick',        // pick | busy | grid | items
      file: null,
      origFile: null,
      url: '',
      workCanvas: null,    // 经过旋转或四角透视拉直后的画布
      toolMode: 'none',    // 'none' | 'persp' (四角透视拉直) | 'grid' (辅助对齐网格)
      corners: null,       // [{x,y} x 4] 归一化 0..1 坐标 (TL, TR, BR, BL)
      gridBox: {           // 辅助网格归一化边界 (左、右、上、下、行数)
        left: 0.12,
        right: 0.98,
        top: 0.10,
        bottom: 0.96,
        rows: (Store.periods && Store.periods.length) ? Math.min(12, Store.periods.length) : 10
      },
      grid: null,
      items: null,
      words: null,         // 本轮识别的词（含坐标与置信度）
      confOnly: false,     // 只看存疑：把高置信格子压暗，突出要核对的
      touched: {},         // 'r,c' → 1，用户手动改过的格子（改过就不再算存疑）
      progress: '',
      pct: 0,
      error: '',
      courses: null,
      mode: 'local'
    };
    bodyEl = el('div', { class: 'ocr' });
    api = V.modal({
      title: '导入课表',
      width: '800px',
      body: bodyEl,
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '关闭', onclick: function () { api.close(); } })
      ])
    });
    if (!global.__cpOcrPasteBound) {
      global.__cpOcrPasteBound = true;
      document.addEventListener('paste', function (e) {
        if (!bodyEl || !document.body.contains(bodyEl) || !S || S.step !== 'pick') return;
        var items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        for (var i = 0; i < items.length; i++) {
          if (items[i].type && items[i].type.indexOf('image/') === 0) {
            var f = items[i].getAsFile();
            if (f) {
              e.preventDefault();
              pickFile(f);
              UI.toast('已从剪贴板粘贴课表截图');
              break;
            }
          }
        }
      });
    }
    draw();
  }

  /* ==========================================================
   * 渲染
   * ========================================================== */
  function draw() {
    bodyEl.innerHTML = '';
    if (S.step === 'pick') drawPick();
    else if (S.step === 'busy') drawBusy();
    else if (S.step === 'grid') drawGrid();
    else if (S.step === 'items') drawItems();
    else if (S.step === 'cloud') drawCloud();
  }

  /* ---------- 第一步：选图 + 图像矫正与辅助网格工作台 ---------- */
  function drawPick() {
    var cfg = Store.state.settings.ocr || {};
    var cloudReady = !!(cfg.endpoint && cfg.apiKey);

    bodyEl.appendChild(el('div', { class: 'ocr-intro' }, [
      el('b', { text: '把课表截图或照片变成课程' }),
      el('p', { text: '支持教务系统截图、Excel 导出的图片、纸质课表拍照（支持直接按 Ctrl+V 粘贴剪贴板截图）。内置「彩色底纹去噪」「四角透视拉直」「交互式辅助网格对齐」与「高校课程词库自动纠偏」。' })
    ]));

    var fileInput = el('input', {
      type: 'file', accept: 'image/*',
      style: { display: 'none' },
      onchange: function () {
        var f = fileInput.files && fileInput.files[0];
        if (f) pickFile(f);
      }
    });

    var cameraInput = el('input', {
      type: 'file', accept: 'image/*', capture: 'environment',
      style: { display: 'none' },
      onchange: function () {
        var f = cameraInput.files && cameraInput.files[0];
        if (f) pickFile(f);
      }
    });

    var pickRow = el('div', { class: 'ocr-pick-row' }, [
      el('button', { class: 'btn btn-primary btn-lg', onclick: function () { fileInput.click(); } },
        [V.svg(V.icons.upload, 17), '选择图片']),
      el('button', { class: 'btn btn-lg', onclick: function () { cameraInput.click(); } },
        [V.svg(V.icons.camera, 17), '拍照']),
      fileInput, cameraInput
    ]);
    bodyEl.appendChild(pickRow);

    if (S.url) {
      // 图像预处理与辅助对齐工具栏
      var prepBar = el('div', {
        class: 'ocr-toolbar',
        style: { marginTop: '10px', marginBottom: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }
      }, [
        el('button', {
          class: 'btn btn-sm',
          text: '🔄 旋转 90°',
          onclick: function () {
            if (!S.workCanvas || !global.Ocr.rotateCanvas) return;
            S.workCanvas = global.Ocr.rotateCanvas(S.workCanvas, 90);
            syncWorkCanvasToFile(function () { draw(); });
          }
        }),
        el('button', {
          class: 'btn btn-sm' + (S.toolMode === 'persp' ? ' btn-primary' : ''),
          text: '📐 四角透视拉直',
          onclick: function () {
            S.toolMode = S.toolMode === 'persp' ? 'none' : 'persp';
            if (S.toolMode === 'persp' && !S.corners) {
              S.corners = global.Ocr.detectCorners ? global.Ocr.detectCorners(S.workCanvas) : [
                { x: 0.05, y: 0.05 }, { x: 0.95, y: 0.05 }, { x: 0.95, y: 0.95 }, { x: 0.05, y: 0.95 }
              ];
            }
            draw();
          }
        }),
        el('button', {
          class: 'btn btn-sm' + (S.toolMode === 'grid' ? ' btn-primary' : ''),
          text: '📏 辅助对齐网格' + (S.useCustomGrid ? ' (已启用)' : ''),
          onclick: function () {
            S.toolMode = S.toolMode === 'grid' ? 'none' : 'grid';
            if (S.toolMode === 'grid') S.useCustomGrid = true;
            draw();
          }
        }),
        S.origFile ? el('button', {
          class: 'btn btn-sm',
          text: '↺ 还原原图',
          onclick: function () {
            S.toolMode = 'none';
            S.corners = null;
            S.useCustomGrid = false;
            pickFile(S.origFile, true);
          }
        }) : null
      ]);
      bodyEl.appendChild(prepBar);

      // 四角透视拉直子操作条
      if (S.toolMode === 'persp') {
        bodyEl.appendChild(el('div', {
          class: 'card',
          style: { padding: '8px 12px', marginBottom: '8px', background: 'var(--primary-weak)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }
        }, [
          el('span', { style: { fontSize: '12px', color: 'var(--text-2)' }, text: '💡 拖动下图 4 个角标对齐纸质课表的四个角，再点「执行透视拉直」即可将斜拍课表展平为标准矩形。' }),
          el('div', { style: { display: 'flex', gap: '6px' } }, [
            el('button', {
              class: 'btn btn-sm',
              text: '✨ 自动吸附四角',
              onclick: function () {
                if (global.Ocr.detectCorners && S.workCanvas) {
                  S.corners = global.Ocr.detectCorners(S.workCanvas);
                  draw();
                }
              }
            }),
            el('button', {
              class: 'btn btn-sm btn-primary',
              text: '✓ 执行透视拉直',
              onclick: function () {
                if (!S.workCanvas || !S.corners || !global.Ocr.warpPerspective) return;
                S.workCanvas = global.Ocr.warpPerspective(S.workCanvas, S.corners);
                S.toolMode = 'none';
                S.corners = null;
                syncWorkCanvasToFile(function () {
                  UI.toast('已完成四角透视拉直矫正');
                  draw();
                });
              }
            })
          ])
        ]));
      }

      // 交互式辅助网格子操作条
      if (S.toolMode === 'grid') {
        var gb = S.gridBox;
        var rowInput = el('input', {
          type: 'number', min: '4', max: '16', value: String(gb.rows),
          style: { width: '58px', height: '28px', textAlign: 'center' },
          onchange: function () {
            gb.rows = Math.max(4, Math.min(16, parseInt(this.value, 10) || 10));
            draw();
          }
        });
        bodyEl.appendChild(el('div', {
          class: 'card',
          style: { padding: '8px 12px', marginBottom: '8px', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }
        }, [
          el('span', { style: { fontSize: '12px', color: 'var(--text-2)' }, text: '📏 拖动下图红/蓝边界线框住「周一至周日 × 第1至N节」的课程主体区域（避开顶部星期表头和左侧节次列）：' }),
          el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
            el('span', { style: { fontSize: '12px' }, text: '节次行数:' }),
            rowInput,
            el('button', {
              class: 'btn btn-sm',
              text: S.useCustomGrid ? '关闭网格约束' : '启用网格约束',
              onclick: function () {
                S.useCustomGrid = !S.useCustomGrid;
                draw();
              }
            })
          ])
        ]));
      }

      // 预览与交互式画布叠加层
      var preview = el('div', {
        class: 'ocr-preview',
        style: { position: 'relative', display: 'inline-block', maxWidth: '100%' }
      });
      var imgEl = el('img', { src: S.url, alt: '课表预览', style: { display: 'block', maxWidth: '100%' } });
      preview.appendChild(imgEl);

      if (S.toolMode === 'persp' || S.toolMode === 'grid') {
        var overlay = buildInteractiveOverlay(imgEl);
        preview.appendChild(overlay);
      }
      bodyEl.appendChild(preview);

      var modeRow = el('div', { class: 'ocr-mode' }, [
        el('div', { class: 'ocr-mode-label', text: '识别方式' }),
        el('div', { class: 'seg-wrap' }, [
          V.segment([
            { value: 'local', label: '本地识别' },
            { value: 'cloud', label: '云端识别' }
          ], S.mode, function (v) { S.mode = v; draw(); })
        ]),
        el('p', {
          class: 'ocr-hint',
          text: S.mode === 'local'
            ? '在本机浏览器里识别，不上传图片。首次使用需下载约 1.8MB 中文模型。'
            : (cloudReady
              ? '调用你配置的视觉大模型接口，自动拆分连堂课与单双周，准确率更高。'
              : '还没配置云端接口，请到 设置 → 图片识别 里填写。')
        })
      ]);
      bodyEl.appendChild(modeRow);

      if (S.error) bodyEl.appendChild(el('div', { class: 'ocr-error', text: S.error }));

      var canRun = S.mode === 'local' || cloudReady;
      bodyEl.appendChild(el('div', { class: 'ocr-actions' }, [
        el('button', {
          class: 'btn btn-primary btn-lg',
          disabled: canRun ? null : 'disabled',
          onclick: function () {
            if (S.mode === 'cloud') runCloud();
            else runLocal();
          }
        }, [V.svg(V.icons.target, 17), '开始识别']),
        el('button', {
          class: 'btn', text: '清空',
          onclick: function () { S.file = null; S.origFile = null; S.url = ''; S.workCanvas = null; S.error = ''; draw(); }
        })
      ]));
    }
  }

  /** 构建四角透视控制点或 7×N 辅助对齐网格的交互式 Canvas 覆盖层 */
  function buildInteractiveOverlay(imgEl) {
    var ov = document.createElement('canvas');
    ov.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;touch-action:none;cursor:crosshair;';
    var dragging = null;

    function syncSize() {
      var rect = imgEl.getBoundingClientRect();
      ov.width = Math.max(200, Math.round(rect.width || imgEl.clientWidth || 560));
      ov.height = Math.max(150, Math.round(rect.height || imgEl.clientHeight || 380));
      paintOverlay();
    }

    imgEl.addEventListener('load', syncSize);
    setTimeout(syncSize, 30);

    function paintOverlay() {
      var w = ov.width, h = ov.height;
      var ctx = ov.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);

      if (S.toolMode === 'persp' && S.corners && S.corners.length === 4) {
        var pts = S.corners.map(function (c) { return { x: c.x * w, y: c.y * h }; });
        ctx.fillStyle = 'rgba(15, 23, 42, 0.28)';
        ctx.fillRect(0, 0, w, h);

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.lineTo(pts[1].x, pts[1].y);
        ctx.lineTo(pts[2].x, pts[2].y);
        ctx.lineTo(pts[3].x, pts[3].y);
        ctx.closePath();
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.restore();

        var labels = ['左上', '右上', '右下', '左下'];
        pts.forEach(function (pt, i) {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 10, 0, Math.PI * 2);
          ctx.fillStyle = '#2563eb';
          ctx.fill();
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(labels[i], pt.x, pt.y - 14);
        });
      } else if (S.toolMode === 'grid') {
        var gb = S.gridBox;
        var x0 = gb.left * w, x1 = gb.right * w;
        var y0 = gb.top * h, y1 = gb.bottom * h;

        // 7 列竖线
        ctx.strokeStyle = 'rgba(37, 99, 235, 0.85)';
        ctx.lineWidth = 1.5;
        var days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
        for (var c = 0; c <= 7; c++) {
          var cx = x0 + (x1 - x0) * (c / 7);
          ctx.beginPath();
          ctx.moveTo(cx, y0);
          ctx.lineTo(cx, y1);
          ctx.stroke();
          if (c < 7) {
            ctx.fillStyle = 'rgba(37, 99, 235, 0.88)';
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(days[c], cx + (x1 - x0) / 14, Math.max(12, y0 - 4));
          }
        }

        // N 行横线
        var nRows = gb.rows || 10;
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.85)';
        for (var r = 0; r <= nRows; r++) {
          var ry = y0 + (y1 - y0) * (r / nRows);
          ctx.beginPath();
          ctx.moveTo(x0, ry);
          ctx.lineTo(x1, ry);
          ctx.stroke();
          if (r < nRows) {
            ctx.fillStyle = 'rgba(5, 150, 105, 0.9)';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText((r + 1) + '节', Math.max(22, x0 - 4), ry + (y1 - y0) / (nRows * 2) + 4);
          }
        }

        // 四个外框拖动手柄（左、右、上、下）
        var handles = [
          { k: 'left', x: x0, y: (y0 + y1) / 2 },
          { k: 'right', x: x1, y: (y0 + y1) / 2 },
          { k: 'top', x: (x0 + x1) / 2, y: y0 },
          { k: 'bottom', x: (x0 + x1) / 2, y: y1 }
        ];
        handles.forEach(function (hd) {
          ctx.beginPath();
          ctx.arc(hd.x, hd.y, 8, 0, Math.PI * 2);
          ctx.fillStyle = '#ef4444';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();
        });
      }
    }

    function relPos(e) {
      var rect = ov.getBoundingClientRect();
      var touch = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
      return {
        x: Math.max(0.01, Math.min(0.99, (touch.clientX - rect.left) / Math.max(1, rect.width))),
        y: Math.max(0.01, Math.min(0.99, (touch.clientY - rect.top) / Math.max(1, rect.height)))
      };
    }

    ov.addEventListener('pointerdown', function (e) {
      var p = relPos(e);
      if (S.toolMode === 'persp' && S.corners) {
        var bestI = -1, bestD = 0.08;
        S.corners.forEach(function (c, i) {
          var d = Math.hypot(c.x - p.x, c.y - p.y);
          if (d < bestD) { bestD = d; bestI = i; }
        });
        if (bestI >= 0) {
          dragging = { type: 'corner', index: bestI };
          if (ov.setPointerCapture) { try { ov.setPointerCapture(e.pointerId); } catch (_) {} }
          e.preventDefault();
        }
      } else if (S.toolMode === 'grid') {
        var gb = S.gridBox;
        var candidates = [
          { k: 'left', d: Math.abs(p.x - gb.left) },
          { k: 'right', d: Math.abs(p.x - gb.right) },
          { k: 'top', d: Math.abs(p.y - gb.top) },
          { k: 'bottom', d: Math.abs(p.y - gb.bottom) }
        ].sort(function (a, b) { return a.d - b.d; });
        if (candidates[0].d < 0.06) {
          dragging = { type: 'grid', edge: candidates[0].k };
          if (ov.setPointerCapture) { try { ov.setPointerCapture(e.pointerId); } catch (_) {} }
          e.preventDefault();
        }
      }
    });

    ov.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var p = relPos(e);
      if (dragging.type === 'corner') {
        S.corners[dragging.index] = { x: Number(p.x.toFixed(3)), y: Number(p.y.toFixed(3)) };
        paintOverlay();
      } else if (dragging.type === 'grid') {
        var gb = S.gridBox;
        if (dragging.edge === 'left') gb.left = Math.min(gb.right - 0.15, p.x);
        else if (dragging.edge === 'right') gb.right = Math.max(gb.left + 0.15, p.x);
        else if (dragging.edge === 'top') gb.top = Math.min(gb.bottom - 0.15, p.y);
        else if (dragging.edge === 'bottom') gb.bottom = Math.max(gb.top + 0.15, p.y);
        paintOverlay();
      }
    });

    function stopDrag() { dragging = null; }
    ov.addEventListener('pointerup', stopDrag);
    ov.addEventListener('pointercancel', stopDrag);

    return ov;
  }

  function syncWorkCanvasToFile(cb) {
    if (!S.workCanvas) { if (cb) cb(); return; }
    S.workCanvas.toBlob(function (blob) {
      if (blob) {
        if (S.url) { try { URL.revokeObjectURL(S.url); } catch (_) {} }
        S.file = new File([blob], (S.origFile && S.origFile.name) || 'schedule.png', { type: 'image/png' });
        S.url = URL.createObjectURL(blob);
      }
      if (cb) cb();
    }, 'image/png');
  }

  function pickFile(f, keepOrig) {
    if (!/^image\//.test(f.type)) { UI.toast('请选择图片文件', 'err'); return; }
    if (f.size > 12 * 1024 * 1024) { UI.toast('图片太大了（建议 12MB 以内）', 'err'); return; }
    if (!keepOrig) S.origFile = f;
    S.file = f;
    S.error = '';
    S.url = URL.createObjectURL(f);
    if (global.Ocr && global.Ocr.normalizeImage) {
      global.Ocr.normalizeImage(f).then(function (n) {
        S.workCanvas = n.canvas;
      }).catch(function () {});
    }
    draw();
  }

  /* ---------- 识别中 ---------- */
  function drawBusy() {
    var bar = el('div', { class: 'ocr-bar' }, [
      el('i', { style: { width: S.pct + '%' } })
    ]);
    bodyEl.appendChild(el('div', { class: 'ocr-busy' }, [
      el('div', { class: 'ocr-spinner' }),
      el('b', { text: S.progress || '正在识别…' }),
      bar,
      el('p', { class: 'ocr-hint', text: '首次使用需要下载中文识别模型（约 1.8MB），请稍候。' })
    ]));
    S._bar = bar.firstChild;
  }

  function setProgress(text, pct) {
    S.progress = text;
    if (pct != null) S.pct = Math.max(0, Math.min(100, pct));
    if (S._bar) S._bar.style.width = S.pct + '%';
    var t = V.$('.cp-ocr-busy b', bodyEl);
    if (t) t.textContent = text;
  }

  /* ---------- 本地识别 ---------- */
  function runLocal() {
    S.step = 'busy';
    S.progress = '准备中…';
    S.pct = 2;
    draw();

    var statusMap = {
      'loading tesseract core': '加载识别引擎…',
      'initializing tesseract': '初始化引擎…',
      'loading language traineddata': '下载中文模型…',
      'initializing api': '准备识别…',
      'recognizing text': '正在识别文字…'
    };

    global.Ocr.recognizeLocal(S.file, function (m) {
      if (!m) return;
      var label = statusMap[m.status] || m.status || '识别中…';
      var pct = m.progress != null ? Math.round(8 + m.progress * 88) : S.pct;
      setProgress(label, pct);
    }, { canvas: S.workCanvas }).then(function (res) {
      if (!res.words.length) {
        S.step = 'pick';
        S.error = '没有识别到文字，试试更清晰、正对的截图';
        draw();
        return;
      }
      var customLines = null;
      if (S.useCustomGrid && S.gridBox && res.width && res.height) {
        var gb = S.gridBox;
        var vl = [], hl = [];
        for (var c = 0; c <= 7; c++) {
          vl.push(Math.round((gb.left + (gb.right - gb.left) * (c / 7)) * res.width));
        }
        var nR = gb.rows || 10;
        for (var r = 0; r <= nR; r++) {
          hl.push(Math.round((gb.top + (gb.bottom - gb.top) * (r / nR)) * res.height));
        }
        customLines = { vlines: vl, hlines: hl };
      }
      S.grid = global.Ocr.buildGrid(res.words, { lines: res.lines, customLines: customLines });
      S.words = res.words;
      S.touched = {};          // 新一轮识别，之前的「已改过」记录作废
      S.confOnly = false;
      S.step = 'grid';
      draw();
    }).catch(function (e) {
      S.step = 'pick';
      S.error = e.message || '识别失败';
      draw();
    });
  }

  /* ---------- 云端识别 ---------- */
  function runCloud() {
    S.step = 'busy';
    S.pct = 30;
    S.progress = '上传识别中…';
    draw();

    global.Ocr.recognizeCloud(S.file, Store.state.settings.ocr).then(function (courses) {
      if (!courses.length) {
        S.step = 'pick';
        S.error = '云端没有返回课程，换一张更清晰的图试试';
        draw();
        return;
      }
      S.courses = courses;
      S.items = cloudToItems(courses);
      if (!S.items.length) {
        S.step = 'pick';
        S.error = '云端没有返回可导入的课程';
        draw();
        return;
      }
      S.step = 'items';
      draw();
    }).catch(function (e) {
      S.step = 'pick';
      S.error = '云端识别失败：' + (e.message || '未知错误');
      draw();
    });
  }

  /* ---------- 第三步：网格校正 ---------- */
  /* ==========================================================
   * 置信度：分级与统计都走 Ocr 模块（同一份判定，单测能覆盖）
   * ========================================================== */
  function confLevel(c) { return global.Ocr.confLevel(c); }
  function confAt(g, ri, ci) { return global.Ocr.confAt(g, ri, ci); }
  function confStats(g) { return global.Ocr.confStats(g, S.touched); }

  var confHintEl = null, confBtnEl = null;

  /** 改完一格就刷新顶部提示与「只看存疑」按钮上的计数 */
  function refreshConfHint() {
    var st = confStats(S.grid);
    if (confHintEl) {
      if (!st.filled) {
        confHintEl.textContent = '还没有识别出内容，可以直接在格子里手写。';
        confHintEl.className = 'cp-ocr-hint';
      } else if (!st.suspect) {
        confHintEl.textContent = '这 ' + st.filled + ' 格都认得挺清楚，扫一眼就能往下走。';
        confHintEl.className = 'cp-ocr-hint cp-ocr-calm';
      } else {
        confHintEl.textContent = '这 ' + st.filled + ' 格里有 ' + st.suspect + ' 格拿不准' +
          (st.low ? '（' + st.low + ' 格标红的最该改）' : '') + '，改完标记会自动消失。';
        confHintEl.className = 'cp-ocr-hint cp-ocr-suspect';
      }
    }
    if (confBtnEl) {
      confBtnEl.textContent = S.confOnly ? '只看存疑 · 开' : '只看存疑' + (st.suspect ? ' ' + st.suspect : '');
      confBtnEl.classList.toggle('cp-btn-primary', !!S.confOnly);
      confBtnEl.disabled = !st.suspect && !S.confOnly;
      confBtnEl.classList.toggle('cp-is-off', !st.suspect && !S.confOnly);
    }
  }

  function drawGrid() {
    var g = S.grid;
    var periods = Store.periods;

    bodyEl.appendChild(el('div', { class: 'ocr-intro' }, [
      el('b', { text: '核对一下识别结果' }),
      el('p', { text: '表头的「星期几」「第几节」「时间」已经自动去掉了；直接点格子改剩下的内容，再点「解析成课程」，下一步可以分别填写课程名、地点和老师。' })
    ]));

    /* 结构识别情况提示 */
    var m = g.meta || {};
    if (!m.dayHeaders && !m.customGrid) {
      bodyEl.appendChild(el('div', {
        class: 'ocr-warn',
        text: '没在图上找到「星期几」表头，列可能没对齐。可以点「返回调整对齐网格」用辅助网格框选，或者直接在下面改格子。'
      }));
    }

    var toolbar = el('div', { class: 'ocr-toolbar' }, [
      el('button', {
        class: 'btn btn-sm', text: '＋ 一行',
        onclick: function () {
          if (g.rows.length >= periods.length) { UI.toast('行数已达到节次数，请先在设置里增加节次'); return; }
          g.rows.push({ y: 0, label: '第 ' + (g.rows.length + 1) + ' 节' });
          g.cells.push(g.cols.map(function () { return ''; }));
          if (g.conf) g.conf.push(g.cols.map(function () { return null; }));
          draw();
        }
      }),
      el('button', {
        class: 'btn btn-sm', text: '－ 一行',
        onclick: function () {
          if (g.rows.length <= 1) return;
          g.rows.pop(); g.cells.pop();
          if (g.conf) g.conf.pop();
          draw();
        }
      }),
      el('button', {
        class: 'btn btn-sm', text: '清理末尾空行',
        onclick: function () {
          syncCells();
          var removed = 0;
          while (g.rows.length > 1 && g.cells[g.rows.length - 1].every(function (t) { return !(t || '').trim(); })) {
            g.rows.pop(); g.cells.pop();
            if (g.conf) g.conf.pop();
            removed++;
          }
          if (removed) { UI.toast('已清理 ' + removed + ' 个空行'); draw(); }
          else { UI.toast('末尾没有多余空行'); }
        }
      }),
      el('button', {
        class: 'btn btn-sm', text: '合并连堂课',
        title: '检测同列连续节次的同名课程',
        onclick: function () {
          syncCells();
          var merged = 0;
          g.cols.forEach(function (col, ci) {
            for (var ri = 1; ri < g.rows.length; ri++) {
              var prev = (g.cells[ri - 1] && g.cells[ri - 1][ci] || '').trim();
              var cur = (g.cells[ri] && g.cells[ri][ci] || '').trim();
              if (prev && cur && prev === cur) {
                g.cells[ri][ci] = '';
                if (g.conf && g.conf[ri]) g.conf[ri][ci] = null;
                merged++;
              }
            }
          });
          if (merged) { UI.toast('已合并 ' + merged + ' 节连堂课'); draw(); }
          else { UI.toast('未发现连续同名课程'); }
        }
      }),
      (confBtnEl = el('button', {
        class: 'btn btn-sm', text: '只看存疑',
        title: '把认得清楚的格子压暗，只留下要核对的',
        onclick: function () { S.confOnly = !S.confOnly; draw(); }
      })),
      el('button', {
        class: 'btn btn-sm', text: '📏 返回调整对齐网格',
        onclick: function () { S.step = 'pick'; S.toolMode = 'grid'; S.useCustomGrid = true; draw(); }
      }),
      el('button', {
        class: 'btn btn-sm', text: '重新识别',
        onclick: function () { S.step = 'pick'; S.grid = null; draw(); }
      })
    ]);
    bodyEl.appendChild(toolbar);

    /* 存疑统计：一句话说清「有几格该看」 */
    confHintEl = el('div', { class: 'ocr-hint' });
    bodyEl.appendChild(confHintEl);
    refreshConfHint();

    var wrap = el('div', { class: 'ocr-grid-wrap' });
    var table = el('table', { class: 'ocr-table' });

    var thead = el('thead');
    var hr = el('tr');
    hr.appendChild(el('th', { class: 'ocr-th-time', text: '节次' }));
    g.cols.forEach(function (c) {
      hr.appendChild(el('th', { text: c.label }));
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = el('tbody');
    g.rows.forEach(function (row, ri) {
      var tr = el('tr');
      var p = periods[ri];
      tr.appendChild(el('td', { class: 'ocr-td-time' }, [
        el('b', { text: p ? p.name : '第' + (ri + 1) + '节' }),
        el('span', { text: p ? p.start : '' })
      ]));
      g.cols.forEach(function (col, ci) {
        var val = (g.cells[ri] && g.cells[ri][ci]) || '';
        var isFilled = !!val.trim();
        var key = ri + ',' + ci;
        // 改过的格子不再标存疑：用户已经用眼睛确认过了
        var lv = (isFilled && !S.touched[key]) ? confLevel(confAt(g, ri, ci)) : '';
        var cls = 'ocr-cell' + (isFilled ? ' has-content' : '') + (lv ? ' ocr-' + lv : '');
        if (!lv && S.confOnly && isFilled) cls += ' ocr-dim';
        var ta = el('textarea', {
          class: cls,
          rows: val.split('\n').length > 1 ? 3 : 2,
          dataset: { r: ri, c: ci },
          title: lv === 'low' ? '这格识别得很不确定（' + confAt(g, ri, ci) + '%），建议改一下'
               : lv === 'mid' ? '这格有点拿不准（' + confAt(g, ri, ci) + '%），值得看一眼' : null,
          oninput: function () {
            ta.classList.toggle('cp-has-content', !!ta.value.trim());
            var marked = ta.classList.contains('cp-ocr-low') || ta.classList.contains('cp-ocr-mid');
            ta.classList.remove('cp-ocr-low', 'cp-ocr-mid', 'cp-ocr-dim');
            S.touched[key] = 1;
            if (marked) refreshConfHint();
          }
        });
        ta.value = val;
        tr.appendChild(el('td', {}, [ta]));
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    bodyEl.appendChild(wrap);

    /* 下一步：拆成课程明细 */
    var count = countFilled();
    bodyEl.appendChild(el('div', { class: 'ocr-actions' }, [
      el('button', {
        class: 'btn btn-primary btn-lg',
        onclick: function () {
          S.items = toItems();
          if (!S.items.length) {
            UI.toast('没有可导入的课程，先在格子里写点内容', 'err');
            return;
          }
          S.step = 'items';
          draw();
        }
      }, ['解析成课程 →']),
      el('span', {
        class: 'ocr-hint',
        text: count ? '已填 ' + count + ' 格' : '还没有识别出课程，可以手动填写'
      })
    ]));
  }

  /* ==========================================================
   * 网格 → 课程明细
   * ========================================================== */
  function syncCells() {
    V.$$('.cp-ocr-cell', bodyEl).forEach(function (ta) {
      var r = parseInt(ta.dataset.r, 10);
      var c = parseInt(ta.dataset.c, 10);
      if (S.grid.cells[r]) S.grid.cells[r][c] = ta.value;
    });
  }

  /**
   * 把网格内容拆成课程列表。
   * 真正的解析在 Ocr.gridToItems（与离线基准共用），这里只负责把界面上的
   * 最新输入同步回网格，再补上本页面依赖的节次表与学期周数。
   */
  function toItems() {
    syncCells();
    return global.Ocr.gridToItems(S.grid, Store.periods, Store.semester.weeks);
  }

  /** 云端结果 → 同样的明细结构 */
  function cloudToItems(courses) {
    var periods = Store.periods;
    var items = [];
    (courses || []).forEach(function (c) {
      var day = Math.max(1, Math.min(7, parseInt(c.day, 10) || 1));
      var s = Math.max(1, parseInt(c.start, 10) || 1);
      var e = Math.max(s, parseInt(c.end, 10) || s);
      var name = String(c.name || '').trim();
      if (!name || global.Ocr.isHeaderWord(name)) return;
      for (var p = s; p <= e; p++) {
        var period = periods[p - 1];
        var info = global.Ocr.parseCell(name);
        var wk = global.Ocr.parseWeeks(c.weeks, Store.semester.weeks) ||
                 { weekType: 'all', startWeek: 1, endWeek: Store.semester.weeks };
        items.push({
          day: day,
          periodId: period ? period.id : '',
          periodName: period ? period.name : ('第 ' + p + ' 节'),
          name: info.name || name,
          correctedFrom: c.correctedFrom || info.correctedFrom || '',
          location: c.location || info.location || '',
          teacher: c.teacher || info.teacher || '',
          weeks: c.weeks || info.weeks || '',
          weekType: wk.weekType,
          startWeek: wk.startWeek,
          endWeek: wk.endWeek,
          raw: name
        });
      }
    });
    return items;
  }

  /* ==========================================================
   * 第四步：课程明细（课程名 / 地点 / 教师 分开编辑 + 词库纠偏提示）
   * ========================================================== */
  function drawItems() {
    var items = S.items || [];
    var dn = Store.DAY_NAMES;
    var correctedCount = items.filter(function (it) { return !!it.correctedFrom; }).length;

    bodyEl.appendChild(el('div', { class: 'ocr-intro' }, [
      el('b', { text: '共 ' + items.length + ' 门课' + (correctedCount ? ('（✨ 专业词库已自动纠偏 ' + correctedCount + ' 处错别字）') : '') }),
      el('p', { text: '课程名、地点、老师已经分开，直接改就行；不需要的可以删掉。周次写成「1-16」「单周」「双周」，留空表示整个学期。' })
    ]));

    var itemFilter = (S._itemFilter || '').trim().toLowerCase();
    var searchBox = el('div', { class: 'ocr-search-bar' }, [
      V.svg(V.icons.search, 15),
      el('input', {
        placeholder: '筛选课程名、老师或地点…',
        value: S._itemFilter || '',
        oninput: function () {
          S._itemFilter = this.value;
          draw();
        }
      })
    ]);
    bodyEl.appendChild(searchBox);

    if (!items.length) {
      bodyEl.appendChild(el('div', { class: 'q-empty', text: '没有课程，返回上一步补几个格子吧' }));
    }

    var list = el('div', { class: 'ocr-items' });
    items.forEach(function (it, i) {
      function inp(field, placeholder, cls) {
        var box = el('input', {
          class: 'input ' + (cls || ''),
          value: it[field] || '',
          placeholder: placeholder,
          oninput: function () { it[field] = box.value; }
        });
        return box;
      }
      var weekVal = it.weeks || (it.weekType === 'all' && it.startWeek === 1 &&
                    it.endWeek === Store.semester.weeks ? '' : it.weeks);

      var isDup = Store.courses.some(function (c) {
        return c.day === it.day && c.periodId === it.periodId && c.name === it.name;
      });
      if (itemFilter) {
        var lineStr = [it.name, it.location, it.teacher].join(' ').toLowerCase();
        if (lineStr.indexOf(itemFilter) < 0) return;
      }
      list.appendChild(el('div', { class: 'ocr-item' }, [
        el('div', { class: 'ocr-item-head' }, [
          el('span', { class: 'chip chip-primary', text: '周' + dn[it.day - 1].slice(1) }),
          el('span', { class: 'ocr-item-period', text: it.periodName }),
          it.correctedFrom ? el('span', {
            class: 'chip chip-green',
            style: { fontSize: '11px', padding: '1px 6px', cursor: 'pointer' },
            title: '点击还原为原始识别文字：' + it.correctedFrom,
            text: '✨ 已纠偏（原：' + it.correctedFrom + '）',
            onclick: function () {
              it.name = it.correctedFrom;
              it.correctedFrom = '';
              draw();
            }
          }) : null,
          (function () {
            var lv = confLevel(it.conf);
            if (!lv) return null;
            return el('span', {
              class: 'ocr-conf-badge ocr-conf-' + lv,
              text: (lv === 'low' ? '识别存疑 ' : '不太确定 ') + it.conf + '%',
              title: '这一格的平均识别置信度，建议核对课程名有没有错字'
            });
          })(),
          isDup ? el('span', { class: 'ocr-dup-badge', text: '已存在' }) : null,
          el('button', {
            class: 'icon-btn', title: '删除这门课',
            onclick: function () { S.items.splice(i, 1); draw(); }
          }, [V.svg(V.icons.trash, 15)])
        ]),
        inp('name', '课程名', 'oi-name'),
        el('div', { class: 'ocr-item-row' }, [
          inp('location', '地点', 'oi-loc'),
          inp('teacher', '老师', 'oi-tea'),
          el('input', {
            class: 'input oi-week', value: weekVal, placeholder: '周次',
            oninput: function () {
              it.weeks = this.value;
              var w = global.Ocr.parseWeeks(this.value, Store.semester.weeks);
              if (w) { it.weekType = w.weekType; it.startWeek = w.startWeek; it.endWeek = w.endWeek; }
              else { it.weekType = 'all'; it.startWeek = 1; it.endWeek = Store.semester.weeks; }
            }
          })
        ]),
        it.raw && it.raw !== it.name ? el('div', { class: 'ocr-item-raw', text: '原文：' + it.raw.replace(/\n/g, ' / ') }) : null
      ]));
    });
    bodyEl.appendChild(list);

    bodyEl.appendChild(el('div', { class: 'ocr-actions' }, [
      el('button', {
        class: 'btn btn-primary btn-lg',
        disabled: items.length ? null : 'disabled',
        onclick: importItems
      }, ['导入 ' + items.length + ' 门课']),
      el('button', {
        class: 'btn btn-sm',
        text: '一键设为 1-' + Store.semester.weeks + '周',
        onclick: function () {
          items.forEach(function (it) {
            it.weekType = 'all';
            it.startWeek = 1;
            it.endWeek = Store.semester.weeks;
            it.weeks = '1-' + Store.semester.weeks + '周';
          });
          draw();
          UI.toast('已将所有课程设为 1-' + Store.semester.weeks + ' 周');
        }
      }),
      el('button', {
        class: 'btn', text: '返回网格',
        onclick: function () { S.step = S.grid ? 'grid' : 'pick'; draw(); }
      })
    ]));
  }

  function importItems() {
    var added = 0, skipped = 0;
    var base = Store.courses.length;

    (S.items || []).forEach(function (it) {
      var name = String(it.name || '').trim();
      if (!name) return;
      if (!it.periodId) { skipped++; return; }
      var dup = Store.courses.some(function (c) {
        return c.day === it.day && c.periodId === it.periodId && c.name === name;
      });
      if (dup) { skipped++; return; }
      Store.addCourse({
        name: name,
        day: it.day,
        periodId: it.periodId,
        location: it.location || '',
        teacher: it.teacher || '',
        color: courseColor(base + added),
        weekType: it.weekType || 'all',
        startWeek: it.startWeek || 1,
        endWeek: it.endWeek || Store.semester.weeks
      });
      added++;
    });

    finishImport(added, skipped);
  }

  function countFilled() {
    var n = 0;
    V.$$('.cp-ocr-cell', bodyEl).forEach(function (t) { if (t.value.trim()) n++; });
    return n;
  }

  /* ==========================================================
   * 导入
   * ========================================================== */
  function courseColor(i) {
    var colors = Store.COLORS || ['#4f46e5'];
    return colors[i % colors.length];
  }

  function finishImport(added, skipped) {
    api.close();
    UI.toast('已导入 ' + added + ' 条课程' + (skipped ? '，跳过 ' + skipped + ' 条重复' : ''));
    App.go('schedule');
  }

  global.OcrDialog = { open: open };
})(window);
