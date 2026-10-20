/* ==========================================================
 * 导入课表：图片 → 识别 → 校正 → 写入课程
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
      url: '',
      grid: null,
      items: null,
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

  /* ---------- 第一步：选图 ---------- */
  function drawPick() {
    var cfg = Store.state.settings.ocr || {};
    var cloudReady = !!(cfg.endpoint && cfg.apiKey);

    bodyEl.appendChild(el('div', { class: 'ocr-intro' }, [
      el('b', { text: '把课表截图或照片变成课程' }),
      el('p', { text: '支持教务系统截图、Excel 导出的图片、纸质课表拍照。识别后可以在网格里改错，再一键导入。' })
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
      var preview = el('div', { class: 'ocr-preview' }, [
        el('img', { src: S.url, alt: '课表预览' })
      ]);
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
              ? '调用你配置的视觉接口，准确率更高，适合复杂版式。'
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
          onclick: function () { S.file = null; S.url = ''; S.error = ''; draw(); }
        })
      ]));
    }
  }

  function pickFile(f) {
    if (!/^image\//.test(f.type)) { UI.toast('请选择图片文件', 'err'); return; }
    if (f.size > 12 * 1024 * 1024) { UI.toast('图片太大了（建议 12MB 以内）', 'err'); return; }
    S.file = f;
    S.error = '';
    S.url = URL.createObjectURL(f);
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
    var t = V.$('.ocr-busy b', bodyEl);
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
    }).then(function (res) {
      if (!res.words.length) {
        S.step = 'pick';
        S.error = '没有识别到文字，试试更清晰、正对的截图';
        draw();
        return;
      }
      S.grid = global.Ocr.buildGrid(res.words, { lines: res.lines });
      S.words = res.words;
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
  function drawGrid() {
    var g = S.grid;
    var periods = Store.periods;

    bodyEl.appendChild(el('div', { class: 'ocr-intro' }, [
      el('b', { text: '核对一下识别结果' }),
      el('p', { text: '表头的「星期几」「第几节」「时间」已经自动去掉了；直接点格子改剩下的内容，再点「解析成课程」，下一步可以分别填写课程名、地点和老师。' })
    ]));

    /* 结构识别情况提示 */
    var m = g.meta || {};
    if (!m.dayHeaders) {
      bodyEl.appendChild(el('div', {
        class: 'ocr-warn',
        text: '没在图上找到「星期几」表头，列可能没对齐。可以在上面直接改格子，或者换用云端识别。'
      }));
    }

    var toolbar = el('div', { class: 'ocr-toolbar' }, [
      el('button', {
        class: 'btn btn-sm', text: '＋ 一行',
        onclick: function () {
          if (g.rows.length >= periods.length) { UI.toast('行数已达到节次数，请先在设置里增加节次'); return; }
          g.rows.push({ y: 0, label: '第 ' + (g.rows.length + 1) + ' 节' });
          g.cells.push(g.cols.map(function () { return ''; }));
          draw();
        }
      }),
      el('button', {
        class: 'btn btn-sm', text: '－ 一行',
        onclick: function () {
          if (g.rows.length <= 1) return;
          g.rows.pop(); g.cells.pop();
          draw();
        }
      }),
      el('button', {
        class: 'btn btn-sm', text: '重新识别',
        onclick: function () { S.step = 'pick'; S.grid = null; draw(); }
      })
    ]);
    bodyEl.appendChild(toolbar);

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
        var ta = el('textarea', {
          class: 'ocr-cell',
          rows: val.split('\n').length > 1 ? 3 : 2,
          dataset: { r: ri, c: ci }
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
    V.$$('.ocr-cell', bodyEl).forEach(function (ta) {
      var r = parseInt(ta.dataset.r, 10);
      var c = parseInt(ta.dataset.c, 10);
      if (S.grid.cells[r]) S.grid.cells[r][c] = ta.value;
    });
  }

  function weekOf(info) {
    var w = global.Ocr.parseWeeks(info.weeks, Store.semester.weeks);
    return w || { weekType: 'all', startWeek: 1, endWeek: Store.semester.weeks };
  }

  /** 把网格内容拆成课程列表（课程名 / 地点 / 教师 / 周次 分开） */
  function toItems() {
    syncCells();
    var periods = Store.periods;
    var items = [];

    S.grid.rows.forEach(function (row, ri) {
      var pIdx = (row.periodIndex || (ri + 1)) - 1;
      var period = periods[pIdx];
      S.grid.cols.forEach(function (col, ci) {
        var text = (S.grid.cells[ri] && S.grid.cells[ri][ci]) || '';
        if (!text.trim()) return;
        var info = global.Ocr.parseCell(text);
        if (!info.name) return;
        if (global.Ocr.isHeaderWord(info.name)) return;   // 漏网的表头
        var wk = weekOf(info);
        items.push({
          day: col.day,
          periodId: period ? period.id : '',
          periodName: period ? period.name : ('第 ' + (pIdx + 1) + ' 节'),
          name: info.name,
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
   * 第四步：课程明细（课程名 / 地点 / 教师 分开编辑）
   * ========================================================== */
  function drawItems() {
    var items = S.items || [];
    var dn = Store.DAY_NAMES;

    bodyEl.appendChild(el('div', { class: 'ocr-intro' }, [
      el('b', { text: '共 ' + items.length + ' 门课' }),
      el('p', { text: '课程名、地点、老师已经分开，直接改就行；不需要的可以删掉。周次写成「1-16」「单周」「双周」，留空表示整个学期。' })
    ]));

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

      list.appendChild(el('div', { class: 'ocr-item' }, [
        el('div', { class: 'ocr-item-head' }, [
          el('span', { class: 'chip chip-primary', text: '周' + dn[it.day - 1].slice(1) }),
          el('span', { class: 'ocr-item-period', text: it.periodName }),
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
    V.$$('.ocr-cell', bodyEl).forEach(function (t) { if (t.value.trim()) n++; });
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
