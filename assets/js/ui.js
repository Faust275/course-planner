

/* ==========================================================
 * UI 基础层：DOM 助手 / 弹窗 / Toast / 确认框
 * ========================================================== */
(function (global) {
  'use strict';

  /* ---------- DOM 助手 ---------- */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') node.className = String(v).split(/\s+/).filter(Boolean).map(function(c){return /^(cp-|gp-|pet-)/.test(c)?c:'cp-'+c;}).join(' ');
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'style' && typeof v === 'object') {
          Object.keys(v).forEach(function (p) {
            if (p.indexOf('--') === 0) node.style.setProperty(p, v[p]);
            else node.style[p] = v[p];
          });
        }
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === 'dataset') {
          Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; });
        } else if (k === 'value' && tag === 'textarea') {
          // textarea 的 value 不是 HTML 属性：setAttribute('value') 不生效，
          // 必须写进内容，否则「预填正文」会显示为空
          node.value = v;
        } else node.setAttribute(k, v);
      });
    }
    appendAll(node, children);
    return node;
  }

  function appendAll(parent, children) {
    if (children == null) return parent;
    if (!Array.isArray(children)) children = [children];
    children.forEach(function (c) {
      if (c == null || c === false || c === true) return;
      if (Array.isArray(c)) { appendAll(parent, c); return; }   // 支持嵌套数组
      parent.appendChild(typeof c === 'string' || typeof c === 'number'
        ? document.createTextNode(String(c)) : c);
    });
    return parent;
  }

  function svg(paths, size) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    if (size) { s.style.width = size + 'px'; s.style.height = size + 'px'; }
    if (!paths) paths = [];
    (Array.isArray(paths) ? paths : [paths]).forEach(function (d) {
      var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d);
      s.appendChild(p);
    });
    return s;
  }

  /** 通过 innerHTML 字符串创建元素 */
  function frag(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  /* ---------- Toast ---------- */
  function toast(msg, type) {
    var root = document.getElementById('toastRoot');
    var icons = {
      ok: 'M20 6L9 17l-5-5',
      err: 'M12 8v5M12 16.5v.01M12 3l9.5 16.5H2.5L12 3z',
      info: 'M12 16v-5M12 8v.01M12 21a9 9 0 100-18 9 9 0 000 18z'
    };
    type = type || 'ok';
    var node = el('div', { class: 'toast ' + type }, [svg(icons[type] || icons.ok, 16), el('span', { text: msg })]);
    root.appendChild(node);
    setTimeout(function () {
      node.classList.add('cp-out');
      setTimeout(function () { node.remove(); }, 220);
    }, 1900);
  }

  /* ---------- Modal ---------- */
  var openCount = 0;

  function syncScrim() {
    document.getElementById('scrim').classList.toggle('cp-show', openCount > 0);
  }

  /**
   * 打开弹窗
   * @param {Object} opts {title, body(HTMLElement), footer(HTMLElement), width, onClose}
   * @returns {{close:Function, root:HTMLElement}}
   */
  function modal(opts) {
    var root = document.getElementById('modalRoot');
    var box = el('div', { class: 'modal', style: opts.width ? { maxWidth: opts.width } : {} });

    var api = {
      close: function () {
        box.classList.remove('cp-show');
        wrap.style.background = 'transparent';
        setTimeout(function () {
          wrap.remove();
          openCount = Math.max(0, openCount - 1);
          syncScrim();
          if (opts.onClose) opts.onClose();
        }, 200);
      },
      root: box,
      setFooter: function (node) {
        var old = $('.cp-modal-foot', box);
        if (old) old.remove();
        box.appendChild(node);
      }
    };

    var head = el('div', { class: 'modal-head' }, [
      el('h3', { text: opts.title || '' })
    ]);
    var closeBtn = el('button', { class: 'icon-btn', onclick: function () { api.close(); }, 'aria-label': '关闭' },
      [svg('M18 6L6 18M6 6l12 12')]);
    // closeBtn 放在最右：先插入占位让标题占据剩余空间
    head.style.justifyContent = 'flex-start';
    head.appendChild(el('div', { style: { marginLeft: 'auto' } }, [closeBtn]));

    var body = el('div', { class: 'modal-body' });
    if (opts.body) {
      if (typeof opts.body === 'string') body.innerHTML = opts.body;
      else arrayify(opts.body).forEach(function (n) { body.appendChild(n); });
    }

    box.appendChild(head);
    box.appendChild(body);
    if (opts.footer) arrayify(opts.footer).forEach(function (n) { box.appendChild(n); });

    var wrap = el('div', {
      class: 'modal-wrap',
      onclick: function (e) { if (e.target === wrap) api.close(); }
    }, [box]);

    /* 已有弹窗时，再加一层遮罩，避免两层标题叠在一起 */
    if (openCount > 0) wrap.style.background = 'rgba(17, 20, 33, .38)';

    root.appendChild(wrap);
    openCount++;
    syncScrim();
    document.getElementById('scrim').onclick = topClose;

    requestAnimationFrame(function () {
      box.classList.add('cp-show');
      if (opts.autofocus) {
        var f = $('[data-autofocus]', box) || $('input, textarea, select', box);
        if (f) setTimeout(function () { f.focus(); }, 120);
      }
    });

    function onKey(e) { if (e.key === 'Escape') { api.close(); document.removeEventListener('keydown', onKey); } }
    document.addEventListener('keydown', onKey);

    return api;
  }

  function arrayify(x) {
    if (x == null) return [];
    return Array.isArray(x) ? x : [x];
  }

  function topClose() {
    var wraps = $$('.cp-modal-wrap', document.getElementById('modalRoot'));
    if (!wraps.length) return;
    var last = wraps[wraps.length - 1];
    var btn = $('.cp-modal-head .cp-icon-btn', last);
    if (btn) btn.click();
  }

  /** 确认框 */
  function confirm(opts) {
    return new Promise(function (resolve) {
      var m;
      var foot = el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: opts.cancelText || '取消', onclick: function () { m.close(); resolve(false); } }),
        el('button', {
          class: 'btn ' + (opts.danger ? 'btn-danger-solid' : 'btn-primary'),
          text: opts.okText || '确定',
          onclick: function () { m.close(); resolve(true); }
        })
      ]);
      var bodyText = el('p', {
        text: opts.message || '',
        // message 里带换行时按段落显示（子任务说明、多行影响提示都要用）
        style: { fontSize: '13.5px', color: 'var(--text-2)', lineHeight: '1.65', whiteSpace: 'pre-wrap' }
      });
      m = modal({
        title: opts.title || '确认操作',
        body: opts.body ? [opts.body, bodyText] : bodyText,
        footer: foot,
        width: '380px'
      });
      var okBtn = foot.lastChild;
      if (opts.danger) {
        okBtn.className = 'cp-btn cp-btn-danger';
        okBtn.style.cssText = 'background:var(--red);color:#fff;border-color:var(--red)';
      }
    });
  }

  /* ---------- 表单构件 ---------- */
  function field(labelText, control, hint) {
    var children = [];
    if (labelText) children.push(el('label', { text: labelText }));
    children.push(control);
    if (hint) children.push(el('div', { text: hint, style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '5px' } }));
    return el('div', { class: 'field' }, children);
  }

  function input(attrs) { return el('input', Object.assign({ class: 'input' }, attrs)); }
  function textarea(attrs) { return el('textarea', Object.assign({ class: 'textarea' }, attrs)); }

  function select(options, value, attrs) {
    var s = el('select', Object.assign({ class: 'select' }, attrs));
    options.forEach(function (o) {
      var opt = el('option', { value: o.value, text: o.label });
      if (String(o.value) === String(value)) opt.selected = true;
      s.appendChild(opt);
    });
    return s;
  }

  function segment(options, value, onChange) {
    var wrap = el('div', { class: 'segment' });
    options.forEach(function (o) {
      var b = el('button', {
        class: o.value === value ? 'active' : '',
        text: o.label,
        onclick: function () {
          $$('button', wrap).forEach(function (x) { x.classList.remove('cp-active'); });
          b.classList.add('cp-active');
          onChange(o.value);
        }
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  function colorPicker(value, onChange) {
    var wrap = el('div', { class: 'color-picker' });
    Store.COLORS.forEach(function (c) {
      var b = el('button', {
        class: 'color-swatch' + (c === value ? ' active' : ''),
        style: { background: c },
        type: 'button',
        onclick: function () {
          $$('.cp-color-swatch', wrap).forEach(function (x) { x.classList.remove('cp-active'); });
          b.classList.add('cp-active');
          onChange(c);
        }
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  function empty(iconPath, title, desc, actionBtn) {
    return el('div', { class: 'empty' }, [
      svg(iconPath, 46),
      el('b', { text: title }),
      desc ? el('p', { text: desc }) : null,
      actionBtn || null
    ]);
  }

  /* ---------- 图表 ---------- */
  /**
   * 环形饼图
   * @param {Array} items [{ label, value, color }]
   * @param {Object} opts { centerTop, centerSub, fmt }
   */
  function chartPie(items, opts) {
    opts = opts || {};
    var fmt = opts.fmt || function (v) { return String(v); };
    var list = (items || []).filter(function (x) { return x.value > 0; });
    var total = list.reduce(function (a, b) { return a + b.value; }, 0);

    var wrap = el('div', { class: 'chart-pie' });
    var ring = el('div', { class: 'cp-ring' });

    var NS_ = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS_, 'svg');
    svg.setAttribute('viewBox', '0 0 200 200');
    svg.setAttribute('class', 'cp-svg');

    var R = 66, SW = 26, C = 2 * Math.PI * R;
    var bg = document.createElementNS(NS_, 'circle');
    bg.setAttribute('cx', 100); bg.setAttribute('cy', 100); bg.setAttribute('r', R);
    bg.setAttribute('fill', 'none');
    bg.setAttribute('stroke', 'var(--line)');
    bg.setAttribute('stroke-width', SW);
    svg.appendChild(bg);

    var acc = 0;
    if (total > 0) {
      list.forEach(function (x) {
        var frac = x.value / total;
        var seg = document.createElementNS(NS_, 'circle');
        seg.setAttribute('cx', 100); seg.setAttribute('cy', 100); seg.setAttribute('r', R);
        seg.setAttribute('fill', 'none');
        seg.setAttribute('stroke', x.color);
        seg.setAttribute('stroke-width', SW);
        seg.setAttribute('stroke-dasharray', (C * frac - 1.2).toFixed(2) + ' ' + (C - C * frac + 1.2).toFixed(2));
        seg.setAttribute('stroke-dashoffset', (-C * acc).toFixed(2));
        seg.setAttribute('transform', 'rotate(-90 100 100)');
        seg.setAttribute('class', 'cp-seg');
        var t = document.createElementNS(NS_, 'title');
        t.textContent = x.label + ' ' + fmt(x.value);
        seg.appendChild(t);
        svg.appendChild(seg);
        acc += frac;
      });
    }

    ring.appendChild(svg);
    ring.appendChild(el('div', { class: 'cp-center' }, [
      el('b', { text: opts.centerTop || (total ? Math.round(list.reduce(function (a, b) { return a + b.value; }, 0) / total * 100) + '%' : '0%') }),
      el('span', { text: opts.centerSub || '' })
    ]));
    wrap.appendChild(ring);

    var legend = el('div', { class: 'cp-legend' });
    list.forEach(function (x) {
      legend.appendChild(el('div', { class: 'cp-lg' }, [
        el('i', { style: { background: x.color } }),
        el('span', { class: 'cp-lg-name', text: x.label }),
        el('span', { class: 'cp-lg-val', text: fmt(x.value) }),
        el('span', { class: 'cp-lg-pct', text: (total ? Math.round(x.value / total * 100) : 0) + '%' })
      ]));
    });
    wrap.appendChild(legend);
    return wrap;
  }

  /**
   * 柱状图（方形图）
   * @param {Array} items [{ label, value, color, title }]
   */
  function chartBars(items, opts) {
    opts = opts || {};
    var fmt = opts.fmt || function (v) { return String(v); };
    var list = items || [];
    var max = 1;
    list.forEach(function (x) { if (x.value > max) max = x.value; });

    // 项目少时柱子会被 flex 拉得很宽，用 maxCols 给每列封顶并居中
    var box = el('div', {
      class: 'chart-bars' + (list.length > 12 ? ' dense' : '') + (opts.maxCols ? ' capped' : ''),
      style: opts.maxCols ? { maxWidth: (opts.maxCols * 92) + 'px', margin: '0 auto' } : null
    });
    // 柱子多时稀疏显示标签，避免挤成一团
    var step = list.length > 24 ? 5 : list.length > 14 ? 3 : list.length > 9 ? 2 : 1;
    list.forEach(function (x, i) {
      var h = Math.max(3, Math.round(x.value / max * 100));
      var showLabel = (i % step === 0) || i === list.length - 1;
      box.appendChild(el('div', { class: 'cb-col' + (x.active ? ' active' : '') }, [
        el('span', { class: 'cb-val', text: x.value ? fmt(x.value) : '' }),
        el('div', { class: 'cb-bar-wrap' }, [
          el('i', {
            style: { height: h + '%', background: x.color || 'var(--primary)' },
            title: x.title || (x.label + ' ' + fmt(x.value))
          })
        ]),
        el('span', { class: 'cb-label', text: showLabel ? x.label : '' })
      ]));
    });
    return box;
  }

  /**
   * 逐日数据画柱图；超过 35 天自动按 7 天聚合成周，避免标签拥挤
   * @param {Array} days [{ date, d, value }]
   */
  function chartDaily(days, opts) {
    opts = opts || {};
    var threshold = opts.threshold || 35;
    var items = [];

    if (days.length <= threshold) {
      items = days.map(function (x) {
        return {
          label: String(x.d.getDate()),
          value: x.value,
          color: opts.color || 'var(--primary)',
          title: x.date + ' ' + (opts.fmt ? opts.fmt(x.value) : x.value),
          active: opts.activeDate === x.date
        };
      });
    } else {
      for (var i = 0; i < days.length; i += 7) {
        var chunk = days.slice(i, i + 7);
        var sum = chunk.reduce(function (a, b) { return a + (b.value || 0); }, 0);
        var d0 = chunk[0].d;
        var last = chunk[chunk.length - 1];
        items.push({
          label: (d0.getMonth() + 1) + '/' + d0.getDate(),
          value: Math.round(sum * 100) / 100,
          color: opts.color || 'var(--primary)',
          title: d0.getMonth() + 1 + '/' + d0.getDate() + '–' +
                 (last.d.getMonth() + 1) + '/' + last.d.getDate() +
                 ' ' + (opts.fmt ? opts.fmt(Math.round(sum * 100) / 100) : Math.round(sum * 100) / 100),
          active: chunk.some(function (c) { return c.date === opts.activeDate; })
        });
      }
    }
    return chartBars(items, opts);
  }

  /** 范围切换：今天 / 一周 / 一月 / 一季 */
  /**
   * 统计范围切换条
   * @param {string} cur 当前 key
   * @param {function} onChange
   * @param {string[]} [keys] 要显示的 key 列表，默认 ['day','week','month','term']
   */
  function rangeTabs(cur, onChange, keys) {
    keys = keys || ['day', 'week', 'month', 'term'];
    var wrap = el('div', { class: 'dim-tabs' });
    keys.forEach(function (k) {
      var r = RANGES[k];
      if (!r) return;
      wrap.appendChild(el('button', {
        class: 'dim-tab' + (cur === k ? ' active' : ''),
        text: r.name,
        onclick: function () { onChange(k); }
      }));
    });
    return wrap;
  }

  /* ---------- 二级标签输入 ---------- */
  /**
   * 标签输入框：逗号分隔多个标签，用 / 分隔一二级（如 学习/高数,英语）
   * @returns DOM，通过 getValue() 取值
   */
  function tagInput(value, opts) {
    opts = opts || {};
    var box = el('div', { class: 'tag-input' });

    var inp = el('input', {
      class: 'input',
      placeholder: opts.placeholder || '逗号分隔，/ 表示二级，如：学习/高数,英语',
      value: value || ''
    });

    var preview = el('div', { class: 'ti-preview' });
    function drawPreview() {
      preview.innerHTML = '';
      var list = normalizeTags(inp.value);
      list.forEach(function (t) {
        preview.appendChild(tagChip(t, {
          onRemove: function () {
            inp.value = list.filter(function (x) { return x !== t; }).join(',');
            drawPreview();
          }
        }));
      });
    }
    inp.addEventListener('input', drawPreview);
    drawPreview();

    /** 加入 / 移除一个标签 */
    function addTag(want) {
      var cur = normalizeTags(inp.value);
      var i = cur.indexOf(want);
      if (i >= 0) cur.splice(i, 1);
      else {
        if (cur.length >= 6) { toast('单个条目最多 6 个标签', 'err'); return; }
        cur.push(want);
      }
      inp.value = cur.join(',');
      drawPreview();
    }

    /* 已有标签快捷插入 */
    var existing = (typeof Store.tagSuggest === 'function') ? Store.tagSuggest() : [];
    var sugBox = null;
    if (existing.length) {
      sugBox = el('div', { class: 'ti-suggest' });
      // 按一级分组展示，二级缩进
      var tree = Store.tagTree ? Store.tagTree() : [];
      tree.forEach(function (g) {
        sugBox.appendChild(sugChip(g.name, g.count, false));
        g.children.forEach(function (c) {
          sugBox.appendChild(sugChip(c.name, c.count, true, c.full));
        });
      });

      function sugChip(label, count, indent, full) {
        var name = tagFull(full || label);
        var s = Store.tagStyle ? Store.tagStyle(name) : { icon: '', color: '#94a3b8' };
        var kids = [];
        if (s.icon && ICONS[s.icon]) kids.push(el('span', { class: 'tc-ico' }, [svg(ICONS[s.icon], 11)]));
        kids.push(el('span', { text: label }));
        if (count) kids.push(el('i', { text: count }));
        return el('button', {
          class: 'ti-opt' + (indent ? ' indent' : ''),
          style: {
            '--tc': s.color,
            color: s.color,
            background: s.color + (indent ? '20' : '12'),
            borderColor: s.color + '38'
          },
          onclick: function () {
            addTag(tagFull(full || label));
            inp.focus();
          }
        }, kids);
      }
    }

    box.appendChild(inp);
    box.appendChild(preview);

    /* 底部操作：常用标签组合 / 已有标签 */
    var acts = el('div', { class: 'ti-acts' });

    if (Store.tagPresets) {
      acts.appendChild(el('button', {
        class: 'ti-toggle', type: 'button',
        onclick: function () {
          tagPresetPicker(function (name) { addTag(name); inp.focus(); });
        }
      }, [svg(ICONS.plus, 12), '常用标签']));
    }

    if (sugBox) {
      var toggle = el('button', {
        class: 'ti-toggle', type: 'button',
        onclick: function () {
          var open = sugBox.classList.toggle('cp-open');
          toggle.classList.toggle('cp-active', open);
        }
      }, [svg(ICONS.tag, 12), '用过的标签']);
      acts.appendChild(toggle);
      box.appendChild(sugBox);
    }
    box.appendChild(acts);

    box.getValue = function () { return inp.value; };
    box.setValue = function (v) { inp.value = v || ''; drawPreview(); };
    box.input = inp;
    return box;
  }

  /**
   * 标签筛选条：一级标签按钮 + 其下的二级标签
   * @param {string} current 当前选中的标签（一级名或 一级/二级）
   * @param {Function} onChange 选中回调
   */
  function tagFilter(current, onChange, sources) {
    var tree = (Store.tagTree ? Store.tagTree(sources) : []);
    if (!tree.length) return null;

    var bar = el('div', { class: 'tag-bar tree' });

    function chip(label, value, count, cls) {
      var node = tagChip(value, {
        base: 'tag-chip',
        label: label,
        active: current === value,
        noIcon: !value,
        plain: !value
      });
      if (cls) node.classList.add(/^(cp-|gp-|pet-)/.test(cls)?cls:'cp-'+cls);
      if (count) node.appendChild(el('i', { text: count }));
      node.addEventListener('click', function () { onChange(current === value ? '' : value); });
      return node;
    }

    bar.appendChild(chip('全部标签', '', 0, 'all'));
    tree.forEach(function (g) {
      var active = current === g.name;
      bar.appendChild(chip(g.name, g.name, g.count, 'lv1'));
      // 选中一级（或本身有二级选中）时展开二级
      if (g.children.length && (active || current.indexOf(g.name + '/') === 0)) {
        g.children.forEach(function (c) {
          bar.appendChild(chip('↳ ' + c.name, c.full, c.count, 'lv2'));
        });
      }
    });
    return bar;
  }

  /**
   * 单个标签徽标：带图标与颜色
   * @param {string} tag 标签名（支持 一级/二级）
   * @param {Object} opts { label, icon, color, cls, onRemove }
   */
  function tagChip(tag, opts) {
    opts = opts || {};
    var full = tagFull(tag);
    var parts = tagParts(full);
    var s = { icon: '', color: '#94a3b8' };
    if (Store.tagStyle) s = Store.tagStyle(full);
    if (opts.icon != null) s.icon = opts.icon;
    if (opts.color != null) s.color = opts.color;

    var label = opts.label != null ? opts.label : (parts.lv2 || full);
    var kids = [];
    if (!opts.noIcon) {
      if (s.icon && ICONS[s.icon]) kids.push(el('span', { class: 'tc-ico' }, [svg(ICONS[s.icon], 11)]));
      else kids.push(el('i', { class: 'tc-dot' }));
    }
    kids.push(el('span', { class: 'tc-text', text: label }));
    if (opts.onRemove) {
      kids.push(el('button', {
        class: 'ti-x', title: '移除',
        onclick: function (e) { e.stopPropagation(); opts.onRemove(); }
      }, [svg(ICONS.close, 11)]));
    }

    var sty = { '--tc': s.color };
    if (opts.active) {
      sty.background = s.color; sty.color = '#fff'; sty.borderColor = s.color;
    } else if (!opts.plain) {
      sty.background = s.color + '1c'; sty.color = s.color; sty.borderColor = s.color + '38';
    }
    return el('span', {
      class: (opts.base || 'chip chip-tag') + (parts.lv2 ? ' lv2' : '') + (opts.cls ? ' ' + opts.cls : ''),
      style: sty
    }, kids);
  }

  /** 标签小徽标（只读展示） */
  function tagChips(tags) {
    return (tags || []).map(function (t) { return tagChip(t); });
  }

  /** 通用统计卡（今日页、待办、日程、番茄钟共用） */
  function statCard(num, label, color, cls) {
    return el('div', { class: 'sum-card' + (cls ? ' ' + cls : '') }, [
      el('div', { class: 'sum-num', style: color ? { color: color } : null, text: String(num) }),
      el('div', { class: 'sum-label', text: label })
    ]);
  }

  /* ---------- 成就解锁弹窗 ---------- */
  function showAchievement(list) {
    if (!list || !list.length) return;
    // 注意：图标字典挂在 global.UI.icons 上，这里不能直接写裸标识符 icons
    var IC = (global.UI && global.UI.icons) || {};
    list.forEach(function (a, i) {
      setTimeout(function () {
        var tier = (global.Store && Store.ACH_TIERS && Store.ACH_TIERS[a.tier]) || { color: '#ffb300' };
        var m = modal({
          title: '成就解锁',
          width: '320px',
          body: el('div', { class: 'ach-pop' }, [
            el('div', { class: 'ach-pop-icon tier-' + a.tier }, [svg(IC[a.icon] || IC.sparkle, 30)]),
            el('div', { class: 'ach-pop-name', text: a.name }),
            el('div', { class: 'ach-pop-desc', text: a.desc }),
            el('div', { class: 'ach-pop-points', style: { color: tier.color }, text: '+ ' + a.points + ' 积分' })
          ])
        });
        setTimeout(function () { m.close(); }, 2600);
      }, i * 320);
    });
  }

  global.UI = {
    el: el, appendAll: appendAll, svg: svg, frag: frag,
    $: $, $$: $$, escapeHTML: escapeHTML,
    toast: toast, modal: modal, confirm: confirm, showAchievement: showAchievement,
    field: field, input: input, textarea: textarea, select: select,
    segment: segment, colorPicker: colorPicker, empty: empty, statCard: statCard,
    tagInput: tagInput, tagFilter: tagFilter, tagChips: tagChips,
    chartPie: chartPie, chartBars: chartBars, chartDaily: chartDaily, rangeTabs: rangeTabs,
    icons: {
      calendar: ['M8 2v4M16 2v4M3 10h18', 'M5 4h14a2 2 0 012 2v13a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z'],
      today: ['M12 2v3M18.4 5.6l-2.1 2.1M22 11h-3M5.6 5.6L3.5 7.7M2 11h3', 'M12 8a4 4 0 100 8 4 4 0 000-8z'],
      check: ['M4 8h9', 'M4 16h9', 'M17 6l2 2 4-4', 'M17 14l2 2 4-4'],
      settings: ['M12 15a3 3 0 100-6 3 3 0 000 6z', 'M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1A1.6 1.6 0 008 19.4a1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H2a2 2 0 110-4h.1A1.6 1.6 0 004.6 8a1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V2a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H22a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z'],
      plus: ['M12 5v14M5 12h14'],
      trash: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6', 'M10 11v6M14 11v6'],
      left: ['M15 18l-6-6 6-6'],
      right: ['M9 6l6 6-6 6'],
      book: ['M4 4a2 2 0 012-2h13v18H6a2 2 0 00-2 2V4z', 'M4 18h15'],
      download: ['M12 3v12', 'M7 11l5 5 5-5', 'M4 20h16'],
      upload: ['M12 16V4', 'M7 9l5-5 5 5', 'M4 20h16'],
      target: ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M12 16a4 4 0 100-8 4 4 0 000 8z', 'M12 12.5v.01'],
      agenda: ['M8 2v4M16 2v4M3 10h18', 'M5 4h14a2 2 0 012 2v13a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z', 'M8.5 15.5l2 2 3.5-4'],
      quadrant: ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M12 12V3a9 9 0 019 9h-9z'],
      moon: ['M20.8 14.6A8.7 8.7 0 019.4 3.2 8.7 8.7 0 1020.8 14.6z'],
      food: ['M3 11h18a9 9 0 01-18 0z', 'M7 7c0-1.2 1-1.2 1-2.5', 'M12 6.5c0-1.5 1-1.5 1-3', 'M17 7c0-1.2 1-1.2 1-2.5'],
      tomato: ['M12 9a6 6 0 00-6 6c0 3.3 2.7 6 6 6s6-2.7 6-6a6 6 0 00-6-6z', 'M9 8.5C9 6.5 10 5 12 5s3 1.5 3 3.5', 'M14.5 5.2L18 3.5'],
      leaf: ['M4 20C4 12 10 4 20 4c0 10-7 16-16 16z', 'M4 20c3-6 8-9 12-10'],
      tree: ['M12 22v-6', 'M12 16l-5-3M12 16l5-3', 'M12 2a7 7 0 017 7 7 7 0 01-14 0 7 7 0 017-7z'],
      search: ['M11 19a8 8 0 100-16 8 8 0 000 16z', 'M21 21l-4.3-4.3'],
      close: ['M18 6L6 18M6 6l12 12'],
      idea: ['M9 18h6', 'M10 22h4', 'M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z'],
      note: ['M4 4h16v16H4z', 'M8 9h8M8 13h8M8 17h5'],
      wallet: ['M3 7h18v12H3z', 'M3 7l3.5-4h11L21 7', 'M16.5 13.5h1.5'],
      flag: ['M5 21V4', 'M5 4h11l-1.2 3.5L16 11H5'],
      clock: ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M12 7.2V12l3.1 1.9'],
      up: ['M18 15l-6-6-6 6'],
      mic: ['M12 3a3 3 0 013 3v5a3 3 0 01-6 0V6a3 3 0 013-3z', 'M5.5 11.5a6.5 6.5 0 0013 0', 'M12 18v3', 'M9 21h6'],
      camera: ['M3 8h3l2-3h8l2 3h3v12H3z', 'M12 17a4 4 0 100-8 4 4 0 000 8z'],
      down: ['M6 9l6 6 6-6'],
      palette: ['M12 21a9 9 0 010-18c4.4 0 8 3.1 8 6.6 0 2.4-1.9 3.6-3.6 3.6H15a1.9 1.9 0 00-1.9 1.9c0 .7.3 1.1.3 1.8 0 2-1.1 4.1-1.4 4.1z', 'M8.2 9.3h.01M11.2 6.8h.01M15 7.8h.01'],
      flagOn: ['M5 21V4', 'M5 4h11l-1.2 3.5L16 11H5', 'M5 4v17'],

      /* ===== 标签用图标库 ===== */
      /* 学习 */
      cap: ['M12 4L2.5 9 12 14l9.5-5L12 4z', 'M6.5 11.4V17c0 1.6 2.5 3 5.5 3s5.5-1.4 5.5-3v-5.6'],
      bookOpen: ['M12 6.6C10.4 5 8 4.6 4 4.6v13c4 0 6.4.4 8 2 1.6-1.6 4-2 8-2v-13c-4 0-6.4.4-8 2z', 'M12 6.6V19'],
      pen: ['M16.6 3.6l3.8 3.8L8.2 19.6H4.4v-3.8L16.6 3.6z', 'M14.4 5.8l3.8 3.8'],
      calc: ['M5 3h14v18H5z', 'M8 7h8', 'M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01'],
      flask: ['M9 3h6', 'M10 3v6.4L5.6 17.6A2 2 0 007.4 21h9.2a2 2 0 001.8-2.9L14 9.4V3', 'M7.2 15h9.6'],
      lang: ['M4 6h8', 'M8 6v1.2c0 3.7-1.8 6.4-4 7.8', 'M6 11c1 2.2 2.5 3.6 4.6 4.2', 'M12.6 20l4.4-11L21.4 20', 'M14.3 16.4h5.2'],
      code: ['M8 7l-5 5 5 5', 'M16 7l5 5-5 5'],
      /* 生活 */
      home: ['M3 10.5L12 3l9 7.5', 'M5.6 9.4V21h12.8V9.4', 'M10 21v-5.6h4V21'],
      bed: ['M2.5 18v-7.5h19V18', 'M2.5 18h19v3h-19z', 'M6.5 10.5V8a2.2 2.2 0 014.4 0v2.5'],
      shirt: ['M8 3.5l4 2 4-2 5 3-2.2 3.2-1.3-1.1V20H6.5V8.6L5.2 9.7 3 6.5l5-3z'],
      box: ['M3.2 7.2L12 3l8.8 4.2v9.6L12 21l-8.8-4.2V7.2z', 'M3.2 7.2L12 11.4l8.8-4.2', 'M12 11.4V21'],
      paw: ['M7.2 13.6a1.8 1.8 0 100-3.6 1.8 1.8 0 000 3.6z', 'M12 10.8a2 2 0 100-4 2 2 0 000 4z', 'M16.8 13.6a1.8 1.8 0 100-3.6 1.8 1.8 0 000 3.6z', 'M12 12.6c2.6 0 4.6 2 4.6 4.2 0 1.8-1.6 3.2-4.6 3.2s-4.6-1.4-4.6-3.2c0-2.2 2-4.2 4.6-4.2z'],
      drop: ['M12 3.2s6 6.4 6 10.4a6 6 0 11-12 0c0-4 6-10.4 6-10.4z'],
      sparkle: ['M11.5 3.2l1.7 4.4 4.4 1.7-4.4 1.7-1.7 4.4-1.7-4.4L5.4 9.3l4.4-1.7 1.7-4.4z', 'M18 15.8l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8.8-2.1z'],
      /* 工作 */
      briefcase: ['M3 8h18v11H3z', 'M9 8V6.2A1.8 1.8 0 0110.8 4.4h2.4A1.8 1.8 0 0115 6.2V8', 'M3 13h18'],
      laptop: ['M4.5 5.5h15v10h-15z', 'M2 19h20'],
      chart: ['M3 20.5h18', 'M7 20.5V13', 'M12 20.5V5.5', 'M17 20.5v-9'],
      mail: ['M3 6h18v12H3z', 'M3.4 7l8.6 5.8L20.6 7'],
      phone: ['M7.6 3h8.8v18H7.6z', 'M10.6 18.2h2.8'],
      /* 运动 */
      dumbbell: ['M6.5 8.5v7M17.5 8.5v7', 'M4 10.5v3M20 10.5v3', 'M6.5 12h11'],
      ball: ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M12 7.4l4.1 3.6-1.6 5.6H9.5L7.9 11l4.1-3.6z', 'M12 7.4V3.2'],
      heartbeat: ['M2.5 12.5h4l2.2-5.5 3.3 11 2-5.5h7.5'],
      bike: ['M5.8 19a3.6 3.6 0 100-7.2 3.6 3.6 0 000 7.2z', 'M18.2 19a3.6 3.6 0 100-7.2 3.6 3.6 0 000 7.2z', 'M8.6 16l3.6-6.6', 'M12.2 9.4h3.6l2-3.8'],
      /* 娱乐 */
      game: ['M6.5 9h11a4.5 4.5 0 014.5 4.5v.6a3.6 3.6 0 01-6.6 2L15 14.6H9l-1.4 1.5a3.6 3.6 0 01-6.6-2v-.6A4.5 4.5 0 016.5 9z', 'M7.4 11.6v2.4M6.2 12.8h2.4', 'M16.2 12.4h.01M18 14.2h.01'],
      music: ['M9 18V6.2l10-2v11.6', 'M9 18a2.6 2.6 0 11-5.2 0A2.6 2.6 0 019 18z', 'M19 15.8a2.6 2.6 0 11-5.2 0 2.6 2.6 0 015.2 0z'],
      film: ['M3.5 4.5h17v15h-17z', 'M7.5 4.5v15M16.5 4.5v15', 'M3.5 9.5h4M3.5 14.5h4M16.5 9.5h4M16.5 14.5h4'],
      tv: ['M3.5 6h17v11h-17z', 'M8 21h8', 'M12 17v4'],
      brush: ['M16.8 3.2l4 4-8.6 8.6-4.2 1 1-4.2 7.8-9.4z', 'M6.2 15.4l-2 4.4 4.4-2'],
      /* 社交 */
      people: ['M16 20v-1.6a4 4 0 00-4-4H7a4 4 0 00-4 4V20', 'M9.5 10.6a3.6 3.6 0 100-7.2 3.6 3.6 0 000 7.2z', 'M17 20v-1.6a4 4 0 00-3-3.8', 'M16.2 4.3a3.6 3.6 0 010 6.6'],
      chat: ['M20.5 12a7.5 7.5 0 01-11.4 6.4L4 19.4l1.1-4.7A7.5 7.5 0 1120.5 12z'],
      gift: ['M3.5 10.5h17v9.5h-17z', 'M12 10.5V20', 'M12 10.5C9.8 10.5 7 9.3 7 7a2.5 2.5 0 014.7-1.2 2.5 2.5 0 014.6 0C16.8 7 14.2 10.5 12 10.5z'],
      heart: ['M12 20.2s-7.2-4.5-7.2-9.6A4.6 4.6 0 0112 7.4a4.6 4.6 0 017.2 3.2c0 5.1-7.2 9.6-7.2 9.6z'],
      /* 健康 */
      pill: ['M7.9 16.1a4.9 4.9 0 010-7l3.1-3.1a4.9 4.9 0 017 7l-3.1 3.1a4.9 4.9 0 01-7 0z', 'M10.5 6.9l6.6 6.6'],
      /* 出行 */
      car: ['M3 14.5h18', 'M5.6 14.5l1.6-5.2A2 2 0 019 7.8h6a2 2 0 011.9 1.5l1.6 5.2', 'M5 14.5V18h3.2v-3.5', 'M15.8 14.5V18H19v-3.5'],
      bus: ['M4 6.5h16v9H4z', 'M4 15.5v3h2.5v-3M17.5 15.5v3H20v-3', 'M4 10.5h16', 'M8 13h.01M16 13h.01'],
      plane: ['M12 3.2c.9 0 1.6.7 1.6 1.6V9l7 4v2l-7-2.2v4.7l2.6 1.9V21L12 19.4 7.8 21v-1.6l2.6-1.9v-4.7L3.4 15v-2l7-4V4.8c0-.9.7-1.6 1.6-1.6z'],
      pin: ['M12 21s7-6.4 7-11a7 7 0 10-14 0c0 4.6 7 11 7 11z', 'M12 12.6a2.6 2.6 0 100-5.2 2.6 2.6 0 000 5.2z'],
      /* 饮食 */
      coffee: ['M4.2 8.5h12.6v5.8a5 5 0 01-5 5H9.2a5 5 0 01-5-5V8.5z', 'M16.8 9.8h1.8a2.6 2.6 0 010 5.2h-1.8', 'M7 4.6v2.2M10.6 4.2v2.6M14.2 4.6v2.2'],
      bag: ['M6.2 8h11.6l-1 12.2H7.2L6.2 8z', 'M9.2 8V6.2a2.8 2.8 0 015.6 0V8'],
      /* 其他 */
      star: ['M12 3.6l2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.9-5.4 2.9 1-6L3.3 10l6-.9L12 3.6z'],
      sun: ['M12 16.6a4.6 4.6 0 100-9.2 4.6 4.6 0 000 9.2z', 'M12 2.4v2.4M12 19.2v2.4M2.4 12h2.4M19.2 12h2.4', 'M5.2 5.2l1.7 1.7M17.1 17.1l1.7 1.7M18.8 5.2l-1.7 1.7M6.9 17.1l-1.7 1.7'],
      cloud: ['M7.2 18.6a4.3 4.3 0 01-.7-8.5 5.6 5.6 0 0111 0 3.7 3.7 0 01-.6 7.3l-9.7 1.2z'],
      cart: ['M2.5 4h2.6l2.8 11h9.2l2.4-8H6.4', 'M9.5 19.4a1.5 1.5 0 100-3 1.5 1.5 0 000 3z', 'M17.5 19.4a1.5 1.5 0 100-3 1.5 1.5 0 000 3z'],
      coin: ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M8.8 8.6l3.2 4 3.2-4', 'M12 12.6V17', 'M9.4 13.4h5.2M9.4 15.6h5.2'],
      copy: ['M9 9h11v11H9z', 'M15 9V4H4v11h5'],
      grid: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
      jade: ['M12 2.2l7.4 7.4L12 21.8 4.6 9.6z', 'M4.6 9.6h14.8', 'M12 2.2v19.6'],
      dots: ['M6 12h.01M12 12h.01M18 12h.01'],
      tag: ['M20.6 12.6l-8 8a2 2 0 01-2.8 0l-6.4-6.4a2 2 0 01-.6-1.5l.3-7.2 7.2.3a2 2 0 011.5.6l8.8 8.8-2 2z', 'M7.4 7.4h.01']
    }
  };

  var ICONS = global.UI.icons;

  /* ---------- 图标库元信息（名称 + 分组，供选择器使用） ---------- */
  var ICON_NAMES = {
    book: '书本', bookOpen: '翻开的书', cap: '学士帽', pen: '笔', calc: '计算', flask: '实验',
    lang: '语言', code: '代码', idea: '灵感', target: '目标', search: '搜索',
    home: '家', bed: '床', food: '餐具', shirt: '衣服', box: '收纳箱', drop: '水滴',
    sparkle: '打扫', paw: '宠物', coffee: '咖啡', camera: '相机',
    briefcase: '公文包', laptop: '电脑', chart: '图表', people: '人群', mail: '邮件',
    phone: '电话', calendar: '日历', note: '笔记', wallet: '钱包',
    dumbbell: '健身', ball: '球类', heartbeat: '心率', bike: '骑行',
    game: '游戏', music: '音乐', film: '电影', tv: '电视', brush: '画笔',
    chat: '聊天', gift: '礼物', heart: '心',
    pill: '药品', moon: '月亮', leaf: '叶子', tree: '树', tomato: '番茄',
    car: '汽车', bus: '公交', plane: '飞机', pin: '地点',
    bag: '购物袋', cart: '购物车', coin: '钱',
    star: '星标', sun: '太阳', cloud: '云', clock: '时钟', flag: '旗帜', flagOn: '旗帜', copy: '复制', grid: '方格', jade: '合成玉',
    check: '完成', dots: '圆点', tag: '标签', palette: '调色', mic: '麦克风',
    download: '下载', upload: '上传', settings: '设置', plus: '加号', trash: '删除',
    close: '关闭', up: '上', down: '下', left: '左', right: '右',
    today: '今日', agenda: '日程', quadrant: '象限'
  };

  var ICON_GROUPS = [
    { name: '常用', items: ['book', 'pen', 'clock', 'star', 'heart', 'flag', 'target', 'check', 'home', 'sun', 'leaf', 'tree', 'food', 'moon', 'idea'] },
    { name: '学习', items: ['book', 'bookOpen', 'cap', 'pen', 'calc', 'flask', 'lang', 'code', 'idea', 'search', 'note'] },
    { name: '生活', items: ['home', 'bed', 'food', 'shirt', 'box', 'drop', 'sparkle', 'paw', 'coffee', 'camera'] },
    { name: '工作', items: ['briefcase', 'laptop', 'chart', 'people', 'mail', 'phone', 'calendar', 'note', 'wallet', 'coin'] },
    { name: '运动', items: ['dumbbell', 'ball', 'heartbeat', 'bike', 'target'] },
    { name: '娱乐', items: ['game', 'music', 'film', 'tv', 'brush', 'camera', 'star'] },
    { name: '社交', items: ['people', 'chat', 'gift', 'heart', 'phone', 'mail'] },
    { name: '出行', items: ['car', 'bus', 'plane', 'bike', 'pin'] },
    { name: '饮食', items: ['food', 'coffee', 'bag', 'cart'] },
    { name: '其他', items: ['dots', 'tag', 'moon', 'cloud', 'sun', 'tomato', 'tree', 'leaf', 'palette', 'mic', 'clock', 'flag', 'check', 'download', 'upload', 'settings', 'plus', 'close'] }
  ];

  /** 图标名（用于搜索与无障碍） */
  function iconName(key) { return ICON_NAMES[key] || key; }

  /**
   * 图标网格（可内嵌）：分组展示 + 搜索
   * @param {string} current 当前图标 key
   * @param {Function} onPick(key)
   * @returns HTMLElement（附带 setCurrent）
   */
  function iconGrid(current, onPick) {
    var pick = current || '';
    var wrap = el('div', { class: 'icon-grid' });

    var search = el('input', {
      class: 'input', placeholder: '搜索图标，如 书、运动、heart',
      style: { marginBottom: '8px', width: '100%' }
    });
    var scroll = el('div', { class: 'icon-picker' });
    wrap.appendChild(search);
    wrap.appendChild(scroll);

    function draw() {
      scroll.innerHTML = '';
      var kw = search.value.trim().toLowerCase();
      var any = false;
      ICON_GROUPS.forEach(function (g) {
        var items = g.items.filter(function (k) {
          if (!ICONS[k]) return false;
          if (!kw) return true;
          return (iconName(k) + ' ' + k).toLowerCase().indexOf(kw) >= 0;
        });
        if (!items.length) return;
        any = true;
        scroll.appendChild(el('div', { class: 'ip-group-name', text: g.name }));
        var box = el('div', { class: 'ip-grid' });
        items.forEach(function (k) {
          box.appendChild(el('button', {
            class: 'ip-item' + (k === pick ? ' active' : ''),
            type: 'button', title: iconName(k), dataset: { k: k },
            onclick: function () {
              pick = k;
              $$('.cp-ip-item', scroll).forEach(function (b) {
                b.classList.toggle('cp-active', b.dataset.k === k);
              });
              onPick(k);
            }
          }, [svg(ICONS[k], 20)]));
        });
        scroll.appendChild(box);
      });
      if (!any) scroll.appendChild(el('div', { class: 'q-empty', text: '没有匹配的图标' }));
    }
    search.addEventListener('input', draw);
    draw();

    wrap.setCurrent = function (k) {
      pick = k || '';
      $$('.cp-ip-item', scroll).forEach(function (b) {
        b.classList.toggle('cp-active', b.dataset.k === pick);
      });
    };
    return wrap;
  }

  /**
   * 图标选择器弹窗（独立使用）
   * @param {string} current 当前图标 key
   * @param {Function} onPick(key)
   */
  function iconPicker(current, onPick) {
    var m = modal({ title: '选择图标', width: '440px', body: [] });
    var body = $('.cp-modal-body', m.root);
    body.appendChild(iconGrid(current, function (k) { onPick(k); }));
    m.setFooter(el('div', { class: 'modal-foot' }, [
      el('button', {
        class: 'btn', text: '不用图标',
        onclick: function () { onPick(''); m.close(); }
      }),
      el('button', { class: 'btn btn-primary', text: '关闭', onclick: function () { m.close(); } })
    ]));
    return m;
  }

  /**
   * 常用标签弹窗：按分组挑一个标签
   * @param {Function} onPick(tagName)
   */
  function tagPresetPicker(onPick) {
    var m = modal({ title: '常用标签', width: '440px', body: [] });
    var body = $('.cp-modal-body', m.root);
    var groups = Store.tagGroups ? Store.tagGroups() : [];
    var cur = groups[0] || '';

    var bar = el('div', { class: 'pg-bar' });
    var grid = el('div', { class: 'pg-grid' });
    body.appendChild(bar);
    body.appendChild(grid);

    function draw() {
      bar.innerHTML = '';
      groups.forEach(function (g) {
        bar.appendChild(el('button', {
          class: 'pg-tab' + (g === cur ? ' active' : ''),
          text: g, type: 'button',
          onclick: function () { cur = g; draw(); }
        }));
      });
      grid.innerHTML = '';
      var list = Store.tagPresets().filter(function (p) { return p.group === cur; });
      list.forEach(function (p) {
        var s = Store.tagStyle(p.name);
        var parts = tagParts(p.name);
        grid.appendChild(el('button', {
          class: 'pg-item', type: 'button',
          onclick: function () { m.close(); onPick(p.name); }
        }, [
          el('span', { class: 'tr-icon', style: { '--tc': s.color } },
            [s.icon && ICONS[s.icon] ? svg(ICONS[s.icon], 15) : el('i', { class: 'tc-dot' })]),
          el('span', { class: 'pg-name', text: parts.lv2 || p.name })
        ]));
      });
    }
    draw();

    m.setFooter(el('div', { class: 'modal-foot' }, [
      el('button', { class: 'btn', text: '关闭', onclick: function () { m.close(); } })
    ]));
    return m;
  }

  /**
   * 颜色选择：预设色 + 自由取色
   * @param {string} value 当前颜色
   * @param {Function} onChange(color)
   */
  function colorField(value, onChange) {
    var cur = value || '#4f46e5';
    var wrap = el('div', { class: 'color-field' });
    var swWrap = el('div', { class: 'cf-swatches' });

    function mark(c) {
      $$('.cp-cf-swatch', swWrap).forEach(function (x) {
        x.classList.toggle('cp-active', x.dataset.c === c);
      });
      free.value = /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#4f46e5';
      freeHex.textContent = (c || '').toUpperCase();
    }
    function pick(c) { cur = c; mark(c); onChange(c); }

    (global.Store.COLORS || []).concat(['#64748b', '#0f766e', '#a16207', '#be185d', '#1d4ed8', '#65a30d'])
      .forEach(function (c) {
        swWrap.appendChild(el('button', {
          class: 'cf-swatch', type: 'button', dataset: { c: c }, style: { background: c },
          onclick: function () { pick(c); }
        }));
      });

    var freeHex = el('span', { class: 'cf-hex', text: (cur || '').toUpperCase() });
    var free = el('input', {
      class: 'cf-free', type: 'color', value: /^#[0-9a-fA-F]{6}$/.test(cur) ? cur : '#4f46e5',
      onchange: function () { pick(free.value); },
      oninput: function () { freeHex.textContent = free.value.toUpperCase(); }
    });

    wrap.appendChild(swWrap);
    wrap.appendChild(el('div', { class: 'cf-custom' }, [
      free,
      el('span', { class: 'cf-custom-label', text: '自定义' }),
      freeHex
    ]));
    mark(cur);
    return wrap;
  }

  /**
   * 标签编辑弹窗：改图标 / 颜色 / 文字
   * @param {string} tag 原标签（空 = 新建）
   * @param {Function} onSave(newTagOrNull)  返回 null 表示取消
   * @param {Object} opts { canDelete, onDelete }
   */
  function tagEditor(tag, onSave, opts) {
    opts = opts || {};
    var isNew = !tag;
    var style = Store.tagStyle(tag);
    var curIcon = style.icon;
    var curColor = style.color;

    var nameInp = el('input', {
      class: 'input', value: tag || '',
      placeholder: '标签名，二级写成 学习/英语'
    });

    function iconFace() {
      return [
        el('span', { class: 'te-icon-box', style: { '--tc': curColor } },
          [curIcon && ICONS[curIcon] ? svg(ICONS[curIcon], 20) : el('i', { class: 'tc-dot' })]),
        el('span', { class: 'te-icon-text' }, [
          el('b', { text: curIcon ? iconName(curIcon) : '未设置图标' }),
          el('span', { text: '点击更换' })
        ])
      ];
    }

    var iconBtn = el('button', { class: 'te-icon', type: 'button' }, iconFace());
    var iconPanel = el('div', { class: 'te-icon-panel' });
    var grid = null;
    iconBtn.onclick = function () {
      var open = iconPanel.classList.toggle('cp-open');
      iconBtn.classList.toggle('cp-open', open);
      if (!open) return;
      /* 首次展开时创建网格，之后保留以便继续挑选 */
      if (!grid) {
        grid = iconGrid(curIcon, function (k) {
          curIcon = k;
          iconBtn.innerHTML = '';
          appendAll(iconBtn, iconFace());
          drawPreview();
        });
        iconPanel.appendChild(grid);
      }
      iconPanel.scrollTop = 0;
    };

    var preview = el('div', { class: 'te-preview' });
    function drawPreview() {
      preview.innerHTML = '';
      var t = tagFull(nameInp.value || '新标签');
      preview.appendChild(tagChip(t, { icon: curIcon, color: curColor }));
    }
    nameInp.addEventListener('input', drawPreview);
    drawPreview();

    var m = modal({
      title: isNew ? '新建标签' : '编辑标签',
      width: '420px',
      autofocus: true,
      body: [
        el('div', { class: 'field' }, [
          el('label', { text: '标签文字' }),
          nameInp,
          el('div', {
            style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '5px' },
            text: '用 / 分两级，例如「学习/英语」；改名会同步所有已打这个标签的记录。'
          })
        ]),
        el('div', { class: 'field' }, [el('label', { text: '图标' }), iconBtn, iconPanel]),
        el('div', { class: 'field' }, [
          el('label', { text: '颜色' }),
          colorField(curColor, function (c) {
            curColor = c;
            var box = $('.cp-te-icon-box', iconBtn);
            if (box) box.style.setProperty('--tc', c);
            drawPreview();
          })
        ]),
        el('div', { class: 'field' }, [el('label', { text: '效果' }), preview])
      ],
      footer: el('div', { class: 'modal-foot te-foot' }, [
        opts.canDelete ? el('button', {
          class: 'btn btn-danger', text: '删除标签',
          onclick: function () {
            m.close();
            if (opts.onDelete) opts.onDelete();
          }
        }) : null,
        opts.canReset ? el('button', {
          class: 'btn', text: '恢复预设',
          onclick: function () { m.close(); if (opts.onReset) opts.onReset(); }
        }) : null,
        el('button', {
          class: 'btn', text: '取消', onclick: function () { m.close(); }
        }),
        el('button', {
          class: 'btn btn-primary', text: '保存',
          onclick: function () {
            var t = tagFull(nameInp.value);
            if (!t) { toast('请填写标签名', 'err'); return; }
            m.close();
            onSave({ name: t, icon: curIcon, color: curColor });
          }
        })
      ])
    });
    return m;
  }

  global.UI.iconPicker = iconPicker;
  global.UI.tagPresetPicker = tagPresetPicker;
  global.UI.colorField = colorField;
  global.UI.tagEditor = tagEditor;
  global.UI.tagChip = tagChip;
  global.UI.iconName = iconName;
  global.UI.ICON_GROUPS = ICON_GROUPS;
})(window);


