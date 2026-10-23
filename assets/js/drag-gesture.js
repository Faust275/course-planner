/* ==========================================================
 * 通用拖动手势引擎（DragGesture）
 * ----------------------------------------------------------
 * 复用于「课表 / 日程 / 日历 / 计划 / 目标 / 待办 / 专注」等所有
 * 需要长按拖动的场景，统一处理：
 *   - Pointer Events + setPointerCapture（鼠标 / 触摸 / 笔一致）
 *   - touch-action:none 防止移动端拖动时误触发页面滚动
 *   - 6px 阈值区分「点击」与「拖动」，避免误触卡片自带按钮
 *   - 拖动中生成跟随指针的幽灵块（ghost），源块半透明
 *   - 真实拖动后自动吞掉随后那次 click，避免误开详情 / 误触按钮
 *
 * 视图只负责两件事：
 *   onMove(ctx)  —— 用 moveWithin 实时调整 DOM 顺序 / 高亮落点
 *   onEnd(ctx)   —— 用 orderedIds 读出最终顺序，提交一次 Store（触发重渲染）
 * ========================================================== */
window.DragGesture = (function () {
  'use strict';

  var cssInjected = false;
  function ensureCSS() {
    if (cssInjected) return;
    cssInjected = true;
    var s = document.createElement('style');
    s.id = 'cp-drag-style';
    s.textContent = [
      '.cp-drag-item{ touch-action:none; }',
      '.cp-plan-card.cp-drag-item, .cp-goal-card.cp-drag-item,',
      ' .cp-task-row.cp-drag-item, .cp-ag-item.cp-drag-item,',
      ' .cp-cal-event.cp-drag-item, .cp-course-block.cp-drag-item{ cursor:grab; }',
      '.cp-drag-item:active{ cursor:grabbing; }',
      '.cp-drag-source{ opacity:.35; }',
      '.cp-drag-ghost{ position:fixed; z-index:99999; pointer-events:none; margin:0;',
      '  box-shadow:0 10px 28px rgba(0,0,0,.25); opacity:.95; transform:scale(1.02);',
      '  border-radius:14px; }',
      '.cp-drop-before{ box-shadow:inset 0 3px 0 0 var(--primary) !important; }',
      '.cp-drop-after{ box-shadow:inset 0 -3px 0 0 var(--primary) !important; }',
      '.cp-cal-cell.cp-drop-cell{ outline:2px solid var(--primary); outline-offset:-2px; background:var(--primary-faint); }'
    ].join('\n');
    document.head.appendChild(s);
  }

  /** 默认幽灵块：克隆源节点，固定宽高跟随指针 */
  function defaultGhost(src) {
    var g = src.cloneNode(true);
    var base = (src.className || '').replace(/cp-drop-\S+/g, '').trim();
    g.className = base + ' cp-drag-ghost';
    var r = src.getBoundingClientRect();
    g.style.width = r.width + 'px';
    g.style.height = r.height + 'px';
    return g;
  }

  /**
   * 让 elem 可拖动。
   * @param {HTMLElement} elem
   * @param {Object} opts
   *   handle  : 仅当 pointerdown 命中该选择器（或其子元素）才启动拖动
   *   ignore  : 命中该选择器（如按钮）时不启动拖动，留给原点击事件
   *   ghost   : 自定义幽灵块构建函数(elem) -> node
   *   threshold: 触发拖动所需的位移阈值（默认 6px）
   *   disabled: () => bool，返回 true 时整体禁用
   *   onDown/onStart/onMove/onEnd(ctx)
   *     ctx = { dx, dy, evt, ghost, overEl }  （overEl 为指针下的元素）
   * @returns {Function} teardown
   */
  function makeDraggable(elem, opts) {
    opts = opts || {};
    ensureCSS();

    var TH = opts.threshold == null ? 6 : opts.threshold;
    var pid = null, sx = 0, sy = 0;
    var dragging = false, started = false;
    var ghost = null, offX = 0, offY = 0;
    var lastX = 0, lastY = 0, scroller = null, rafId = null;
    var lpTimer = null, suppressDrag = false;

    function isCancelled() { return opts.disabled && opts.disabled(); }

    function clearLp() { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } }

    /** 菜单弹出后，吞掉长按松手时那次 click，避免误开详情 / 立刻关闭菜单 */
    function swallowNextClick() {
      var t = setTimeout(function () { document.removeEventListener('click', swallow, true); }, 700);
      function swallow(ev) {
        // 只吞「长按松手」那一下；菜单项在 .cp-modal 里，必须放行
        if (ev.target && ev.target.closest && ev.target.closest('.cp-modal')) return;
        ev.stopPropagation(); ev.preventDefault();
        document.removeEventListener('click', swallow, true);
        clearTimeout(t);
      }
      document.addEventListener('click', swallow, true);
    }

    function startMenu(swallow) {
      if (!opts.menu) return;
      var items = null;
      try { items = opts.menu(); } catch (_) { items = null; }
      if (!items || !items.length) return;
      suppressDrag = true;
      if (swallow) {
        // 长按：菜单可能盖在卡片上，捕获指针保证松手时仍走 onUp 收尾
        try { elem.setPointerCapture(pid); } catch (_) {}
        swallowNextClick();
      }
      if (window.UI && window.UI.moveMenu) window.UI.moveMenu(opts.menuTitle, items);
    }

    function onCtx(e) {
      if (isCancelled() || !opts.menu) return;
      e.preventDefault();
      startMenu(false);
    }

    function onKeyMenu(e) {
      if (!opts.menu) return;
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        startMenu(false);
      }
    }

    /** 找最近的可滚动祖先（页面本身多数是 #view-wrap 内滚动） */
    function nearestScroller(node) {
      var p = node.parentElement;
      while (p && p !== document.body && p !== document.documentElement) {
        var st, oy;
        try { st = getComputedStyle(p); } catch (_) { st = null; }
        oy = st && st.overflowY;
        if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 2) return p;
        p = p.parentElement;
      }
      return document.scrollingElement || document.documentElement;
    }

    /**
     * 拖动中若指针停在视口（或滚动容器）上下边缘，持续滚动并重算落点。
     * 触摸拖动时 touch-action:none 会禁用原生滚动，长距离拖动（如日历↔待办）
     * 必须靠它才能滚到屏幕外。用 rAF 持续滚，不依赖指针是否还在动。
     */
    function autoScrollTick() {
      if (!started) { rafId = null; return; }
      rafId = requestAnimationFrame(autoScrollTick);
      if (!scroller) scroller = nearestScroller(elem);
      if (!scroller) return;
      var isPage = scroller === document.scrollingElement || scroller === document.documentElement ||
                   scroller === document.body;
      var top, bottom;
      if (isPage) { top = 0; bottom = window.innerHeight; }
      else {
        var rect = scroller.getBoundingClientRect();
        top = rect.top; bottom = rect.bottom;
      }
      var EDGE = 64, MAX = 16, v = 0;
      if (lastY < top + EDGE) v = -Math.ceil((top + EDGE - lastY) / 4);
      else if (lastY > bottom - EDGE) v = Math.ceil((lastY - (bottom - EDGE)) / 4);
      if (!v) return;
      v = Math.max(-MAX, Math.min(MAX, v));
      if (isPage) window.scrollBy(0, v);
      else scroller.scrollTop += v;
      var over = document.elementFromPoint(lastX, lastY);
      if (opts.onMove) {
        opts.onMove({
          dx: lastX - sx, dy: lastY - sy,
          evt: { clientX: lastX, clientY: lastY, target: over },
          ghost: ghost, overEl: over
        });
      }
    }

    function onDown(e) {
      if (isCancelled()) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (opts.ignore && e.target.closest && e.target.closest(opts.ignore)) return;
      if (opts.handle && !(e.target.closest && e.target.closest(opts.handle))) return;
      sx = e.clientX; sy = e.clientY; pid = e.pointerId;
      lastX = e.clientX; lastY = e.clientY; scroller = null;
      dragging = true; started = false; suppressDrag = false;
      // 监听在 document 上：拖动过程中条目会在容器里被 insertBefore 调整顺序，
      // 某些浏览器会因此触发 lostpointercapture，事件不再送到 elem，拖动会「半路断掉」。
      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('pointerup', onUp, true);
      document.addEventListener('pointercancel', onUp, true);
      // 长按不动 = 打开「移动到…」菜单（拖动仍是长按 + 移动）
      if (opts.menu) {
        clearLp();
        lpTimer = setTimeout(function () {
          lpTimer = null;
          if (!started && dragging) startMenu(true);
        }, opts.longPressMs || 550);
      }
      if (opts.onDown) opts.onDown(e);
    }

    function onMove(e) {
      if (!dragging || suppressDrag) return;
      lastX = e.clientX; lastY = e.clientY;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (!started) {
        if (Math.hypot(dx, dy) < TH) return;
        clearLp();
        started = true;
        try { elem.setPointerCapture(pid); } catch (_) {}
        elem.classList.add('cp-drag-source');
        ghost = opts.ghost ? opts.ghost(elem) : defaultGhost(elem);
        document.body.appendChild(ghost);
        var r = elem.getBoundingClientRect();
        offX = sx - r.left; offY = sy - r.top;
        position(e.clientX, e.clientY);
        if (opts.onStart) opts.onStart({ dx: dx, dy: dy, evt: e, ghost: ghost });
        try {
          if (navigator.vibrate && !(window.Store && Store.settings && Store.settings.haptics === false)) navigator.vibrate(8);
        } catch (_) {}
        rafId = requestAnimationFrame(autoScrollTick);
      }
      position(e.clientX, e.clientY);
      var over = document.elementFromPoint(e.clientX, e.clientY);
      if (opts.onMove) opts.onMove({ dx: dx, dy: dy, evt: e, ghost: ghost, overEl: over });
    }

    function onUp(e) {
      if (!dragging) return;
      clearLp();
      dragging = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
      try { elem.releasePointerCapture(pid); } catch (_) {}
      elem.classList.remove('cp-drag-source');
      clearDropHints();
      if (suppressDrag) { suppressDrag = false; ghost = null; started = false; return; }
      var over = started ? document.elementFromPoint(e.clientX, e.clientY) : null;
      if (started) {
        // 拦截本次拖动后合成的 click，避免误触卡片内按钮 / 打开详情。
        // 只在松手后极短时间内生效：合成 click 几乎同刻到达；超时自动摘除，
        // 免得吞掉紧接着用户真正想点的「撤销」/菜单项。
        document.addEventListener('click', killClick, true);
        setTimeout(function () { document.removeEventListener('click', killClick, true); }, 120);
        if (opts.onEnd) opts.onEnd({ dx: e.clientX - sx, dy: e.clientY - sy, evt: e, ghost: ghost, overEl: over });
      }
      if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
      ghost = null; started = false;
    }

    function killClick(ev) {
      ev.stopPropagation();
      ev.preventDefault();
      document.removeEventListener('click', killClick, true);
    }

    function position(x, y) {
      if (!ghost) return;
      ghost.style.left = (x - offX) + 'px';
      ghost.style.top = (y - offY) + 'px';
    }

    elem.addEventListener('pointerdown', onDown);
    elem.classList.add('cp-drag-item');
    if (opts.menu) {
      elem.addEventListener('contextmenu', onCtx);
      elem.addEventListener('keydown', onKeyMenu);
      if (!elem.hasAttribute('tabindex')) elem.setAttribute('tabindex', '0');
      elem.setAttribute('aria-haspopup', 'menu');
    }
    return function teardown() {
      elem.removeEventListener('pointerdown', onDown);
      elem.removeEventListener('contextmenu', onCtx);
      elem.removeEventListener('keydown', onKeyMenu);
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
      elem.classList.remove('cp-drag-item');
      if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
    };
  }

  /** 清掉所有落点高亮 */
  function clearDropHints() {
    var nodes = document.querySelectorAll('.cp-drop-before, .cp-drop-after');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.remove('cp-drop-before', 'cp-drop-after');
    }
  }

  /**
   * 列表内拖动时，把 dragged 插到 overEl 所在条目之前 / 之后
   * （按指针在目标条目内的纵向位置判断）。
   * @param {HTMLElement} container 条目共同的父容器
   * @param {HTMLElement} dragged   正在拖动的条目
   * @param {HTMLElement} overEl    指针下的元素
   * @param {number} clientY        指针纵坐标
   * @param {string} itemSel        条目选择器（默认 [data-id]）
   */
  function moveWithin(container, dragged, overEl, clientY, itemSel) {
    if (!container || !overEl) return;
    itemSel = itemSel || '[data-id]';
    var target = overEl.closest(itemSel);
    if (!target || target === dragged || !container.contains(target)) return;
    var tr = target.getBoundingClientRect();
    var after = clientY > tr.top + tr.height / 2;
    if (after) {
      if (target.nextSibling !== dragged) container.insertBefore(dragged, target.nextSibling);
    } else {
      if (target.previousSibling !== dragged) container.insertBefore(dragged, target);
    }
  }

  /** 读出容器内各条目的 id 顺序（优先 data-drag-id，否则 data-id） */
  function orderedIds(container, itemSel) {
    var ids = [];
    if (!container) return ids;
    itemSel = itemSel || '[data-id]';
    var nodes = container.querySelectorAll(itemSel);
    for (var i = 0; i < nodes.length; i++) {
      var id = nodes[i].getAttribute('data-drag-id') || nodes[i].getAttribute('data-id');
      if (id) ids.push(id);
    }
    return ids;
  }

  /** 给 overEl 加落点提示（before/after），并清掉其它条目的提示 */
  function showDropHint(overEl, clientY, itemSel) {
    clearDropHints();
    itemSel = itemSel || '[data-id]';
    var target = overEl && overEl.closest(itemSel);
    if (!target) return;
    var tr = target.getBoundingClientRect();
    var after = clientY > tr.top + tr.height / 2;
    target.classList.add(after ? 'cp-drop-after' : 'cp-drop-before');
  }

  /* ==========================================================
   * 「移动到…」菜单项构造器（供各视图复用，含撤销）
   * ========================================================== */
  function snapshot(key) {
    var arr = (window.Store && window.Store.state && window.Store.state[key]) || [];
    return arr.map(function (x) { return x.id; });
  }

  /** 排序类菜单：上移 / 下移 / 置顶 / 置底；操作后带「撤销」 */
  function orderMenuItems(key, id, filterFn) {
    var Store = window.Store;
    if (!Store) return [];
    var arr = (Store.state && Store.state[key]) || [];
    var ids = [];
    for (var i = 0; i < arr.length; i++) { if (!filterFn || filterFn(arr[i])) ids.push(arr[i].id); }
    var pos = ids.indexOf(id);
    if (pos < 0) return [];

    function apply(kind, label) {
      var before = snapshot(key);
      var ok;
      if (kind === 'up') ok = Store.moveAmong(key, id, -1, filterFn);
      else if (kind === 'down') ok = Store.moveAmong(key, id, 1, filterFn);
      else if (kind === 'top') ok = Store.moveEdgeAmong(key, id, 'top', filterFn);
      else ok = Store.moveEdgeAmong(key, id, 'bottom', filterFn);
      if (ok && window.UI && window.UI.toastAction) {
        window.UI.toastAction(label, { onAction: function () { Store.reorderInView(key, before); } });
      }
    }

    var items = [];
    if (pos > 0) {
      items.push({ label: '上移一位', onClick: function () { apply('up', '已上移'); } });
      items.push({ label: '移到最前', onClick: function () { apply('top', '已移到最前'); } });
    }
    if (pos < ids.length - 1) {
      items.push({ label: '下移一位', onClick: function () { apply('down', '已下移'); } });
      items.push({ label: '移到最后', onClick: function () { apply('bottom', '已移到最后'); } });
    }
    return items;
  }

  /**
   * 日期类菜单：移到今天 / 明天 / 下周（待办还可清除截止日）。
   * kind = 'event' | 'task'；操作后带「撤销」。
   */
  function dateMenuItems(kind, id) {
    var Store = window.Store;
    var DU = window.DateUtil;
    if (!Store || !DU) return [];
    var items = [];

    function setDate(label, ds) {
      items.push({
        label: label,
        onClick: function () {
          var before = kind === 'event'
            ? ((Store.getEvent(id) || {}).date || '')
            : ((Store.getTask(id) || {}).dueDate || '');
          if (kind === 'event') Store.updateEvent(id, { date: ds });
          else Store.updateTask(id, { dueDate: ds });
          if (window.UI && window.UI.toastAction) {
            window.UI.toastAction(label.replace('移到', '已移到'), {
              onAction: function () {
                if (kind === 'event') Store.updateEvent(id, { date: before });
                else Store.updateTask(id, { dueDate: before });
              }
            });
          }
        }
      });
    }

    var today = DU.today();
    setDate('移到今天', DU.toStr(today));
    setDate('移到明天', DU.toStr(DU.addDays(today, 1)));
    setDate('移到下周', DU.toStr(DU.addDays(today, 7)));

    if (kind === 'task') {
      items.push({ sep: true });
      items.push({
        label: '清除截止日期', danger: true,
        onClick: function () {
          var before = (Store.getTask(id) || {}).dueDate || '';
          Store.updateTask(id, { dueDate: '' });
          if (window.UI && window.UI.toastAction) {
            window.UI.toastAction('已清除截止日期', {
              onAction: function () { Store.updateTask(id, { dueDate: before }); }
            });
          }
        }
      });
    }
    return items;
  }

  return {
    makeDraggable: makeDraggable,
    moveWithin: moveWithin,
    orderedIds: orderedIds,
    showDropHint: showDropHint,
    clearDropHints: clearDropHints,
    orderMenuItems: orderMenuItems,
    dateMenuItems: dateMenuItems
  };
})();
