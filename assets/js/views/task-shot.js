/* ==========================================================
 * 截图 → 待办：活动页 / 通知截图里的事项，识别后勾选批量添加
 * ----------------------------------------------------------
 * 两个通道：
 *   本地 = Tesseract 出词 → 按行聚类 → 过滤噪声 → TaskNLP 逐行解析
 *   云端 = 视觉接口一次调用，直接返回结构化 tasks（需用户自配 Key）
 * 识别结果一律先进候选清单，用户勾选/改标题后才写入，避免误加。
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;

  var S = null;
  var api = null;
  var bodyEl = null;

  /* ---------------- 纯函数（单测直接调） ---------------- */

  /** 界面上的固定噪声：导航、按钮、状态栏文案 */
  var NOISE_EXACT = /^(返回|分享|预览|代码|复制|更多|关闭|取消|确定|完成|加载中|广告|打开APP|立即打开|立即下载|下载|微信|朋友圈|点赞|评论|收藏|关注|举报|首页|消息|我的|推荐|搜索|全部|查看更多|展开|收起|上一页|下一页|顶部|置顶)$/;

  function median(arr) {
    if (!arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /**
   * OCR 常在汉字与数字之间塞空格（「10 月 25 日」「报名 截止」），
   * 会把 TaskNLP 的日期/时间正则打断，这里先压掉这些空格再解析。
   * 英文单词之间的空格原样保留。
   */
  function normalizeLine(text) {
    var t = String(text || '');
    t = t.replace(/(\d)\s+(?=[年月日点时号])/g, '$1');          // 10 月 → 10月
    t = t.replace(/([年月日点时号])\s+(?=\d)/g, '$1');          // 月 25 → 月25
    t = t.replace(/([\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, '$1'); // 报名 截止 → 报名截止
    t = t.replace(/(\d)\s+(?=[\u4e00-\u9fa5])/g, '$1');         // 25 日 → 25日
    t = t.replace(/([\u4e00-\u9fa5])\s+(?=\d)/g, '$1');         // 截止 10 → 截止10
    return t.replace(/\s+/g, ' ').trim();
  }

  /**
   * OCR 词 → 行文本。同一行内的词按 x 排序拼接，中文之间不补空格。
   * @param {Array} words Ocr.recognizeLocal 返回的 words（含 cx/cy/x0/x1/y0/y1）
   * @returns {Array<{text:string, cy:number}>}
   */
  function linesFromWords(words) {
    if (!words || !words.length) return [];
    var arr = words.slice().sort(function (a, b) { return (a.cy - b.cy) || (a.cx - b.cx); });
    var mh = median(arr.map(function (w) { return (w.y1 - w.y0) || 12; })) || 12;
    var tol = Math.max(6, mh * 0.6);

    var rows = [];
    arr.forEach(function (w) {
      if (!String(w.text || '').trim()) return;
      var last = rows[rows.length - 1];
      if (!last || Math.abs(w.cy - last.cy) > tol) {
        rows.push({ cy: w.cy, items: [w] });
      } else {
        last.items.push(w);
        last.cy = (last.cy * (last.items.length - 1) + w.cy) / last.items.length;
      }
    });

    return rows.map(function (r) {
      var items = r.items.slice().sort(function (a, b) { return a.x0 - b.x0; });
      var text = '';
      items.forEach(function (w) {
        var t = String(w.text || '').trim();
        if (!t) return;
        if (!text) { text = t; return; }
        // 中文与中文直接相连；其余补一个空格，避免英文单词粘成一坨
        var glue = (/[\u4e00-\u9fa5]$/.test(text) && /^[\u4e00-\u9fa5]/.test(t)) ? '' : ' ';
        text += glue + t;
      });
      return { text: normalizeLine(text), cy: r.cy };
    }).filter(function (l) { return l.text; });
  }

  /**
   * 这一行值不值得当候选：剔掉时间戳、电量、纯数字、UI 文案、一两个字的碎词。
   * 宁可多留（列表里可取消勾选），只把明显不是人话的挡掉。
   */
  function keepLine(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (t.length < 2 || t.length > 80) return false;
    if (NOISE_EXACT.test(t)) return false;
    // 「点击下方按钮立即报名」这类行动号召，是界面不是事项
    if (/(点击|长按|扫一扫|扫码|拖动|滑到|下方|上方).{0,6}(按钮|报名|查看|下载|关注|领取|进入|打开)/.test(t)) return false;
    if (/^[\d:：.\/%+\-—–~～\s]+$/.test(t)) return false;   // 2026/10/22、10:45、+1
    if (/^\d{1,3}%?$/.test(t)) return false;                 // 82、82%
    if (!/[\u4e00-\u9fa5A-Za-z]/.test(t)) return false;
    var cjk = (t.match(/[\u4e00-\u9fa5]/g) || []).length;
    var lat = (t.match(/[A-Za-z]/g) || []).length;
    if (cjk + lat < 2) return false;
    // 一排只有符号和单个汉字（常见于图标旁的「·」）
    if (cjk === 1 && t.length <= 3 && !/\d/.test(t)) return false;
    return true;
  }

  /** 把云端返回的数组规整成候选结构 */
  function fromCloud(list) {
    var out = [];
    (list || []).forEach(function (x) {
      if (!x) return;
      var title = String(x.title || x.name || '').replace(/\s+/g, ' ').trim();
      if (title.length < 2) return;
      var due = String(x.dueDate || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) due = '';
      var time = String(x.dueTime || '').trim();
      if (!/^\d{1,2}:\d{2}$/.test(time)) time = '';
      out.push({
        title: title,
        dueDate: due,
        dueTime: time,
        note: String(x.note || '').trim(),
        priority: x.priority === 'high' ? 'high' : 'normal',
        important: x.priority === 'high',
        tags: [],
        courseId: '',
        source: title
      });
    });
    return out;
  }

  /**
   * 文本行 → 候选待办。逐行交给 TaskNLP，解析出日期/时间/标签/课程/优先级。
   * @param {Array<string|{text:string}>} lines
   * @param {{courses?:Array}} opts
   */
  function toTasks(lines, opts) {
    opts = opts || {};
    var seen = {};
    var out = [];
    (lines || []).forEach(function (line) {
      var text = typeof line === 'string' ? line : (line && line.text) || '';
      text = normalizeLine(text);
      if (!keepLine(text)) return;
      var p = global.TaskNLP
        ? TaskNLP.parse(text, { courses: opts.courses || [], baseDate: opts.baseDate })
        : { title: text };
      var title = String(p.title || text).replace(/\s+/g, ' ').trim();
      if (title.length < 2) return;
      if (title.length > 40) title = title.slice(0, 40);
      var key = title + '|' + (p.dueDate || '') + '|' + (p.dueTime || '');
      if (seen[key]) return;
      seen[key] = 1;
      out.push({
        title: title,
        dueDate: p.dueDate || '',
        dueTime: p.dueTime || '',
        note: '',
        priority: p.priority || 'normal',
        important: !!p.important,
        tags: p.tags || [],
        courseId: p.courseId || '',
        source: text
      });
    });
    return out;
  }

  /* ---------------- 对话框 ---------------- */

  function open() {
    S = {
      step: 'pick',        // pick | busy | list
      file: null,
      url: '',
      items: [],
      progress: '',
      pct: 0,
      error: '',
      mode: 'local',
      bar: null
    };
    bodyEl = el('div', { class: 'shot' });
    api = V.modal({
      title: '从截图添加待办',
      width: '720px',
      body: bodyEl,
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '关闭', onclick: function () { api.close(); } })
      ])
    });
    draw();
  }

  function draw() {
    bodyEl.innerHTML = '';
    if (S.step === 'pick') drawPick();
    else if (S.step === 'busy') drawBusy();
    else drawList();
  }

  /* ---------- 选图 ---------- */
  function drawPick() {
    var cfg = Store.state.settings.ocr || {};
    var cloudReady = !!(cfg.endpoint && cfg.apiKey);

    bodyEl.appendChild(el('div', { class: 'ocr-intro' }, [
      el('b', { text: '把活动页、通知截图变成待办' }),
      el('p', { text: '识别出的事项会先进候选清单，你勾选并确认后才写入待办，不会直接加。' })
    ]));

    var fileInput = el('input', {
      type: 'file', accept: 'image/*', style: { display: 'none' },
      onchange: function () {
        var f = fileInput.files && fileInput.files[0];
        if (f) pickFile(f);
      }
    });
    var cameraInput = el('input', {
      type: 'file', accept: 'image/*', capture: 'environment', style: { display: 'none' },
      onchange: function () {
        var f = cameraInput.files && cameraInput.files[0];
        if (f) pickFile(f);
      }
    });

    bodyEl.appendChild(el('div', { class: 'ocr-pick-row' }, [
      el('button', { class: 'btn btn-primary btn-lg', onclick: function () { fileInput.click(); } },
        [V.svg(V.icons.upload, 17), '选择截图']),
      el('button', { class: 'btn btn-lg', onclick: function () { cameraInput.click(); } },
        [V.svg(V.icons.camera, 17), '拍照']),
      fileInput, cameraInput
    ]));

    if (S.url) {
      bodyEl.appendChild(el('div', { class: 'ocr-preview' }, [
        el('img', { src: S.url, alt: '截图预览' })
      ]));
    }

    bodyEl.appendChild(el('div', { class: 'ocr-mode' }, [
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
          ? '在本机识别，图片不出设备；首次需要下载约 1.8MB 中文模型。小字截图识别率一般。'
          : (cloudReady
            ? '调用你配置的视觉接口，能直接读懂活动规则并拆出日期，准确率更高。'
            : '还没配置云端接口，请到「设置 → 图片识别」里填接口地址与 API Key。')
      })
    ]));

    if (S.error) bodyEl.appendChild(el('div', { class: 'ocr-error', text: S.error }));

    var canRun = !!S.file && (S.mode === 'local' || cloudReady);
    bodyEl.appendChild(el('div', { class: 'ocr-actions' }, [
      el('button', {
        class: 'btn btn-primary btn-lg',
        disabled: canRun ? null : 'disabled',
        onclick: function () { if (S.mode === 'cloud') runCloud(); else runLocal(); }
      }, [V.svg(V.icons.target, 17), '识别']),
      el('button', {
        class: 'btn', text: '清空',
        onclick: function () { S.file = null; S.url = ''; S.error = ''; draw(); }
      })
    ]));
  }

  function pickFile(f) {
    if (!/^image\//.test(f.type)) { UI.toast('请选择图片文件', 'err'); return; }
    if (f.size > 12 * 1024 * 1024) { UI.toast('图片太大了（建议 12MB 以内）', 'err'); return; }
    S.file = f;
    S.error = '';
    if (S.url) URL.revokeObjectURL(S.url);
    S.url = URL.createObjectURL(f);
    draw();
  }

  /* ---------- 识别中 ---------- */
  function drawBusy() {
    var bar = el('div', { class: 'ocr-bar' }, [el('i', { style: { width: S.pct + '%' } })]);
    bodyEl.appendChild(el('div', { class: 'ocr-busy' }, [
      el('div', { class: 'ocr-spinner' }),
      el('b', { text: S.progress || '正在识别…' }),
      bar,
      el('p', { class: 'ocr-hint', text: S.mode === 'local'
        ? '首次使用需要下载中文识别模型（约 1.8MB），请稍候。'
        : '正在请求云端接口…' })
    ]));
    S.bar = bar.firstChild;
  }

  function setProgress(text, pct) {
    S.progress = text;
    if (pct != null) S.pct = Math.max(0, Math.min(100, pct));
    if (S.bar) S.bar.style.width = S.pct + '%';
    var t = V.$('.cp-ocr-busy b', bodyEl);
    if (t) t.textContent = text;
  }

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
      if (!res.words || !res.words.length) {
        S.step = 'pick';
        S.error = '没有识别到文字，试试更清晰、正对的截图';
        draw();
        return;
      }
      var lines = linesFromWords(res.words).map(function (l) { return l.text; });
      showItems(toTasks(lines, { courses: Store.courses }));
    }).catch(function (e) {
      S.step = 'pick';
      S.error = (e && e.message) || '识别失败';
      draw();
    });
  }

  function runCloud() {
    S.step = 'busy';
    S.progress = '正在请求云端识别…';
    S.pct = 20;
    draw();

    var today = DateUtil.toStr(DateUtil.today());
    global.Ocr.recognizeCloudTasks(S.file, Store.state.settings.ocr, today).then(function (list) {
      var items = fromCloud(list);
      if (!items.length) {
        S.step = 'pick';
        S.error = '云端没有给出可执行的事项，换一张更完整的截图试试';
        draw();
        return;
      }
      showItems(items);
    }).catch(function (e) {
      S.step = 'pick';
      S.error = (e && e.message) || '云端识别失败';
      draw();
    });
  }

  function showItems(items) {
    S.items = items.map(function (x) {
      return { checked: true, title: x.title, dueDate: x.dueDate || '', dueTime: x.dueTime || '',
        note: x.note || '', priority: x.priority || 'normal', important: !!x.important,
        tags: x.tags || [], courseId: x.courseId || '', source: x.source || '' };
    });
    S.step = 'list';
    draw();
  }

  /* ---------- 候选清单 ---------- */
  function drawList() {
    bodyEl.appendChild(el('p', {
      class: 'ocr-hint',
      style: { marginBottom: '8px' },
      text: '识别到 ' + S.items.length + ' 条，取消勾选不需要的；标题和日期可以直接改。'
    }));

    var list = el('div', { class: 'shot-list' });
    S.items.forEach(function (it, i) {
      var cb = el('input', {
        type: 'checkbox',
        onchange: function () {
          it.checked = cb.checked;
          row.classList.toggle('cp-off', !cb.checked);
          refreshCount();
        }
      });
      cb.checked = it.checked;

      var title = el('input', {
        type: 'text', class: 'shot-title', value: it.title,
        oninput: function () { it.title = title.value; }
      });
      var date = el('input', {
        type: 'date', class: 'shot-date', value: it.dueDate,
        onchange: function () { it.dueDate = date.value; }
      });
      var time = el('input', {
        type: 'time', class: 'shot-time', value: it.dueTime,
        onchange: function () { it.dueTime = time.value; }
      });

      var meta = el('div', { class: 'shot-meta' }, [
        date, time,
        it.source && it.source !== it.title
          ? el('span', { class: 'shot-src', text: it.source.slice(0, 30) })
          : null
      ]);

      var row = el('div', { class: 'shot-row' }, [
        el('label', { class: 'shot-check' }, [cb]),
        el('div', { class: 'shot-main' }, [title, meta])
      ]);
      row.classList.toggle('cp-off', !it.checked);
      list.appendChild(row);
    });
    bodyEl.appendChild(list);

    var count = el('b', { text: '' });
    function refreshCount() {
      var n = S.items.filter(function (x) { return x.checked; }).length;
      count.textContent = '添加选中 ' + n + ' 条';
      addBtn.disabled = n === 0 ? 'disabled' : null;
    }

    var addBtn = el('button', {
      class: 'btn btn-primary btn-lg',
      onclick: function () {
        var picked = S.items.filter(function (x) { return x.checked && String(x.title).trim(); });
        if (!picked.length) { UI.toast('还没有勾选任何一条', 'err'); return; }
        picked.forEach(function (x) {
          Store.addTask({
            title: String(x.title).trim(),
            dueDate: x.dueDate || '',
            dueTime: x.dueTime || '',
            note: x.note || '',
            priority: x.priority || 'normal',
            important: !!x.important,
            tags: x.tags || [],
            courseId: x.courseId || '',
            status: 'todo',
            repeat: { type: 'none' }
          });
        });
        UI.toast('已添加 ' + picked.length + ' 条待办');
        api.close();
        if (global.App) App.go('tasks');
      }
    }, [V.svg(V.icons.check, 17), count]);
    refreshCount();

    bodyEl.appendChild(el('div', { class: 'ocr-actions' }, [
      addBtn,
      el('button', {
        class: 'btn', text: '换一张',
        onclick: function () { S.step = 'pick'; S.items = []; draw(); }
      })
    ]));
  }

  global.TaskShot = {
    open: open,
    // 纯函数：供单测与调试
    normalizeLine: normalizeLine,
    linesFromWords: linesFromWords,
    keepLine: keepLine,
    toTasks: toTasks,
    fromCloud: fromCloud
  };
})(window);
