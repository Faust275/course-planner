
/* ==========================================================
 * 全局搜索
 * ----------------------------------------------------------
 * 上面一半是纯函数（不碰 Store、不碰 DOM，直接从 index.html 里提出来单测）；
 * 下面一半才是弹窗和跳转定位。
 *
 * 跳转定位的约定：
 *   视图只要在渲染时给每条记录的根节点带上 data-rec="<类型>:<id>"，
 *   再挂一个 focusRecord(type, id) 就行；没挂的视图退化成「只切页面不定位」，
 *   这样新接入一个视图不会牵动别处。
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;

  /* ==========================================================
   * 一、纯函数区
   * ========================================================== */

  /** 类型 → 集合名 + 目标视图 + 显示名 */
  var TYPE_META = {
    course: { key: 'courses', view: 'schedule', name: '课程', order: 1 },
    task:   { key: 'tasks',   view: 'tasks',    name: '待办', order: 2 },
    event:  { key: 'events',  view: 'calendar', tab: 'agenda', name: '日程', order: 3 },
    plan:   { key: 'plans',   view: 'plans',    name: '计划', order: 4 },
    goal:   { key: 'goals',   view: 'plans',    name: '目标', order: 5 },
    note:   { key: 'notes',   view: 'notes',    name: '笔记', order: 6 },
    diary:  { key: 'diaries', view: 'notes',    name: '日记', order: 7 },
    ledger: { key: 'ledger',  view: 'ledger',   name: '账目', order: 8 }
  };

  var TYPES = Object.keys(TYPE_META);

  /**
   * 在 text 里找 q 的全部命中区间，大小写无关。
   * 返回 [[start, end], ...]，end 为开区间；区间互不重叠
   * （重叠会导致高亮时 <mark> 嵌套，所以命中后跳过整段）。
   */
  function hitsIn(text, q) {
    var s = String(text == null ? '' : text);
    var n = String(q == null ? '' : q).trim();
    if (!n || !s) return [];
    var ls = s.toLowerCase(), ln = n.toLowerCase();
    var out = [], from = 0, i;
    while (from + ln.length <= ls.length) {
      i = ls.indexOf(ln, from);
      if (i < 0) break;
      out.push([i, i + ln.length]);
      from = i + ln.length;
    }
    return out;
  }

  function joinNonEmpty(arr, sep) {
    return (arr || []).filter(function (x) { return x !== '' && x != null; }).join(sep || '');
  }

  /** 把一条记录翻译成「标题 / 副标题 / 正文」三段，供匹配与展示复用 */
  function describe(type, rec) {
    var r = rec || {};
    var tags = joinNonEmpty(r.tags || [], ' ');
    if (type === 'course') {
      return {
        title: r.name || '',
        sub: [r.teacher, r.location].filter(Boolean).join(' · '),
        body: joinNonEmpty([r.note], ' ')
      };
    }
    if (type === 'task') {
      return {
        title: r.title || '',
        // 子任务标注出来，否则搜到「第三章」这种子任务时看不出它属于哪件事
        sub: [r.parentTitle ? '↳ ' + r.parentTitle : '', r.dueDate, r.courseName, tags]
          .filter(Boolean).join(' · '),
        body: joinNonEmpty([r.note, tags], ' ')
      };
    }
    if (type === 'event') {
      return {
        title: r.title || '',
        sub: [r.date, r.location].filter(Boolean).join(' · '),
        body: joinNonEmpty([r.note], ' ')
      };
    }
    if (type === 'plan') {
      return {
        title: r.title || '',
        sub: tags,
        body: joinNonEmpty([r.note, tags], ' ')
      };
    }
    if (type === 'goal') {
      // 关键结果的文字也进 body：搜「自习」应该能搜到挂着它的那个目标
      var gk = (r.krs || []).map(function (k) { return k.title || ''; });
      return {
        title: r.title || '',
        sub: [r.endDate ? '到 ' + r.endDate : '', gk.length ? gk.length + ' 条关键结果' : '']
          .filter(Boolean).join(' · '),
        body: joinNonEmpty([r.note, gk.join(' ')], ' ')
      };
    }
    if (type === 'note') {
      var c = String(r.content || '');
      return {
        title: c.split('\n')[0].slice(0, 40),
        sub: tags,
        body: c
      };
    }
    if (type === 'diary') {
      // 日记没有标题，用日期当选标题：搜出来一眼能认出是哪天
      var dm = r.mood ? Store.moodOf(r.mood) : null;
      var c2 = String(r.content || '');
      return {
        title: r.date + (dm ? ' · ' + dm.emoji + ' ' + dm.name : ''),
        sub: r.date,
        body: c2
      };
    }
    if (type === 'ledger') {
      var head = r.note || r.category || (r.type === 'income' ? '收入' : '支出');
      return {
        title: String(head),
        sub: [r.date, r.amount != null ? '¥' + r.amount : ''].filter(Boolean).join(' · '),
        body: joinNonEmpty([r.note, r.category, tags], ' ')
      };
    }
    return { title: '', sub: '', body: '' };
  }

  /**
   * 长文本截摘要：以第一次命中为中心截前后各 pad 字，
   * 落在窗口内的其余命中一并保留。返回 { text, hits, head, tail }，
   * hits 是相对 text 的偏移。
   */
  function snippet(text, q, pad) {
    pad = pad == null ? 30 : pad;
    var s = String(text == null ? '' : text);
    var all = hitsIn(s, q);
    if (!all.length) {
      return {
        text: s.length > pad * 2 ? s.slice(0, pad * 2) : s,
        hits: [], head: false, tail: s.length > pad * 2
      };
    }
    var a = all[0][0], b = all[all.length - 1][1];
    var start = Math.max(0, a - pad);
    var end = Math.min(s.length, Math.max(b + pad, start + pad * 2 + (b - a)));
    if (end - start > pad * 4) end = start + pad * 4;   // 兜底，别把整篇笔记拉进来
    var hits = [];
    all.forEach(function (h) {
      if (h[0] >= start && h[1] <= end) hits.push([h[0] - start, h[1] - start]);
    });
    return { text: s.slice(start, end), hits: hits, head: start > 0, tail: end < s.length };
  }

  /** 命中权重：标题最重，且越靠前越高；副标题次之；正文最低 */
  function scoreOf(t, s, b) {
    var n = 0;
    if (t.length) n += 1000 - Math.min(200, t[0][0]);
    if (s.length) n += 300;
    if (b.length) n += 100;
    return n;
  }

  /**
   * 跨集合检索。
   * data: { courses, tasks, events, plans, notes, ledger }
   * 返回按「类型顺序 → 分数降序」排好的数组，UI 直接分组渲染。
   */
  function searchAll(data, q, limit) {
    limit = limit || 50;
    var needle = String(q == null ? '' : q).trim();
    if (!needle) return [];
    var d = data || {};
    var out = [];

    TYPES.forEach(function (type) {
      var meta = TYPE_META[type];
      var list = d[meta.key] || [];
      list.forEach(function (rec) {
        if (!rec) return;
        var f = describe(type, rec);
        var th = hitsIn(f.title, needle);
        var sh = hitsIn(f.sub, needle);
        var bh = hitsIn(f.body, needle);
        if (!th.length && !sh.length && !bh.length) return;
        out.push({
          type: type,
          typeName: meta.name,
          view: meta.view,
          id: rec.id || '',
          title: f.title,
          titleHits: th,
          sub: f.sub,
          subHits: sh,
          snippet: snippet(f.body, needle),
          score: scoreOf(th, sh, bh)
        });
      });
    });

    out.sort(function (a, b) {
      var oa = TYPE_META[a.type].order, ob = TYPE_META[b.type].order;
      if (oa !== ob) return oa - ob;
      return b.score - a.score;
    });
    return out.slice(0, limit);
  }

  /** 结果按类型分组，保持顺序；返回 [{ type, name, view, items }] */
  function groupResults(list) {
    var map = {}, order = [];
    (list || []).forEach(function (r) {
      if (!map[r.type]) {
        map[r.type] = { type: r.type, name: r.typeName, view: r.view, items: [] };
        order.push(r.type);
      }
      map[r.type].items.push(r);
    });
    return order.map(function (t) { return map[t]; });
  }

  /* ==========================================================
   * 二、渲染
   * ========================================================== */

  /** 把命中的片段包成 <mark>；没命中就原样返回 */
  function markSpan(text, hits, prefix, suffix) {
    var wrap = el('span');
    if (prefix) wrap.appendChild(document.createTextNode(prefix));
    var s = String(text == null ? '' : text);
    if (!hits || !hits.length) {
      wrap.appendChild(document.createTextNode(s));
    } else {
      var last = 0;
      hits.forEach(function (h) {
        if (h[0] > last) wrap.appendChild(document.createTextNode(s.slice(last, h[0])));
        wrap.appendChild(el('mark', { class: 'hit', text: s.slice(h[0], h[1]) }));
        last = h[1];
      });
      if (last < s.length) wrap.appendChild(document.createTextNode(s.slice(last)));
    }
    if (suffix) wrap.appendChild(document.createTextNode(suffix));
    return wrap;
  }

  /** 结果行 */
  function resultRow(r, onPick) {
    var sn = r.snippet || { text: '', hits: [], head: false, tail: false };
    var body = null;
    if (sn.text) {
      body = el('div', { class: 's-result-sub' }, [
        markSpan(sn.text, sn.hits, sn.head ? '…' : '', sn.tail ? '…' : '')
      ]);
    }
    return el('button', {
      class: 's-result',
      onclick: function () { onPick(r); }
    }, [
      el('div', { class: 's-result-top' }, [
        el('span', { class: 's-result-type', text: r.typeName }),
        el('span', { class: 's-result-title' }, [markSpan(r.title, r.titleHits)])
      ]),
      el('div', { class: 's-result-meta' }, [markSpan(r.sub || '—', r.subHits)]),
      body
    ]);
  }

  /* ==========================================================
   * 三、跳转定位
   * ========================================================== */

  function findRec(type, id) {
    if (!type || !id) return null;
    return document.querySelector('[data-rec="' + type + ':' + id + '"]');
  }

  /** 滚动到视野中央并闪一下描边 */
  function flash(node) {
    if (!node) return false;
    try {
      node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (e) { /* 老浏览器不支持 smooth，忽略 */ }
    node.classList.remove('cp-flash');
    // 强制重排，保证连续点同一条也能再闪一次
    void node.offsetWidth;
    node.classList.add('cp-flash');
    setTimeout(function () { node.classList.remove('cp-flash'); }, 2000);
    return true;
  }

  var pendingFocus = null;

  /** 切到目标视图并定位到那条记录 */
  function goTo(r) {
    if (!r || !r.view) return;
    pendingFocus = { type: r.type, id: r.id };
    var opts = r.tab ? { tab: r.tab } : null;
    if (App.currentId === r.view) {
      afterView(r.view);
    } else {
      App.go(r.view, opts);
      // 视图 render 是同步的，但数据变化可能触发异步重渲染，
      // 所以稍等一拍再定位，失败就再试一次
      setTimeout(function () { afterView(r.view); }, 60);
    }
  }

  function afterView(view) {
    if (!pendingFocus) return;
    var pf = pendingFocus;
    var v = App.views.filter(function (x) { return x.id === view; })[0];
    var ok = false;
    try {
      if (v && v.focusRecord) ok = !!v.focusRecord(pf.type, pf.id);
      if (!ok) ok = flash(findRec(pf.type, pf.id));
    } catch (e) { ok = false; }
    pendingFocus = null;
    if (!ok) UI.toast('已切到「' + ((v && v.name) || '目标页') + '」，但没定位到那条记录');
  }

  /* ==========================================================
   * 四、搜索弹窗
   * ========================================================== */

  var timer = null;

  function openDialog() {
    var listBox = el('div', { class: 's-list' });
    var input = el('input', {
      class: 'input s-input',
      type: 'search',
      placeholder: '搜课程 / 待办 / 日程 / 计划 / 目标 / 日记 / 账目'
    });

    var m = V.modal({
      title: '全局搜索',
      width: '620px',
      body: [
        input,
        el('p', { class: 'ocr-hint', text: '输完自动搜，回车打开第一条，↑↓ 换一条，Esc 关闭。' }),
        listBox
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '关闭', onclick: function () { m.close(); } })
      ])
    });

    var cur = [];

    function render(q) {
      listBox.innerHTML = '';
      var kw = String(q || '').trim();
      if (!kw) {
        listBox.appendChild(el('div', {
          class: 's-empty',
          text: '输入关键词开始搜索'
        }));
        cur = [];
        return;
      }
      var res = searchAll(collect(), kw, 50);
      if (!res.length) {
        listBox.appendChild(el('div', { class: 's-empty', text: '没有找到「' + kw + '」' }));
        cur = [];
        return;
      }
      var groups = groupResults(res);
      var idx = 0;
      cur = res;
      groups.forEach(function (g) {
        listBox.appendChild(el('div', {
          class: 's-group-title',
          text: g.name + '（' + g.items.length + '）'
        }));
        g.items.forEach(function (r) {
          r.__i = idx++;
          listBox.appendChild(resultRow(r, pick));
        });
      });
      var first = listBox.querySelector('.cp-s-result');
      if (first) first.classList.add('cp-sel');
    }

    function pick(r) {
      m.close();
      setTimeout(function () { goTo(r); }, 120);
    }

    function move(d) {
      if (!cur.length) return;
      var nodes = [...listBox.querySelectorAll('.cp-s-result')];
      var at = nodes.findIndex(function (n) { return n.classList.contains('cp-sel'); });
      if (at < 0) at = 0;
      else at = (at + d + nodes.length) % nodes.length;
      nodes.forEach(function (n, i) { n.classList.toggle('cp-sel', i === at); });
      nodes[at].scrollIntoView({ block: 'nearest' });
    }

    input.oninput = function () {
      var q = input.value;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { render(q); }, 200);   // debounce，笔记多时别卡
    };
    input.onkeydown = function (e) {
      if (e.key === 'ArrowDown') { move(1); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { move(-1); e.preventDefault(); }
      else if (e.key === 'Enter') {
        var nodes = [...listBox.querySelectorAll('.cp-s-result')];
        var at = nodes.findIndex(function (n) { return n.classList.contains('cp-sel'); });
        if (at < 0) at = 0;
        if (nodes[at]) nodes[at].click();
        e.preventDefault();
      }
    };

    render('');
    setTimeout(function () { input.focus(); }, 60);
    return m;
  }

  /** 组装待检索的数据；给待办补上课程名，方便搜「高数」时命中作业 */
  function collect() {
    var s = Store.state;
    var courseName = {};
    (s.courses || []).forEach(function (c) { courseName[c.id] = c.name; });
    var titleOf = {};
    (s.tasks || []).forEach(function (t) { titleOf[t.id] = t.title; });
    var tasks = (s.tasks || []).map(function (t) {
      return Object.assign({}, t, {
        courseName: courseName[t.courseId] || '',
        parentTitle: t.parentId ? (titleOf[t.parentId] || '') : ''
      });
    });
    return {
      courses: s.courses || [],
      tasks: tasks,
      events: s.events || [],
      plans: s.plans || [],
      goals: s.goals || [],
      notes: s.notes || [],
      diaries: s.diaries || [],
      ledger: s.ledger || []
    };
  }

  var Search = {
    hitsIn: hitsIn,
    snippet: snippet,
    describe: describe,
    searchAll: searchAll,
    groupResults: groupResults,
    markSpan: markSpan,
    findRec: findRec,
    flash: flash,
    goTo: goTo,
    open: openDialog,
    TYPE_META: TYPE_META
  };

  global.Search = Search;
})(typeof window !== 'undefined' ? window : this);
