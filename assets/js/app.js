

/* ==========================================================
 * App 主控：路由、导航、渲染调度
 * ========================================================== */
(function (global) {
  'use strict';

  var App = {
    views: [],
    current: null,
    currentId: 'schedule'
  };

  function sortViews() {
    var views = (window.VIEWS || []).slice();
    var order = (Store.state.settings && Store.state.settings.navOrder) || [];

    views.sort(function (a, b) {
      var ia = order.indexOf(a.id), ib = order.indexOf(b.id);
      if (ia < 0 && ib < 0) return (a.order || 0) - (b.order || 0);  // 都没排过：用默认
      if (ia < 0) return 1;      // 后排的放后面
      if (ib < 0) return -1;
      return ia - ib;
    });
    App.views = views;
  }

  /** 改了顺序或开关后重建导航 */
  App.rebuildNav = function () {
    sortViews();
    buildNav();
    markActive(App.currentId);
  };

  /* ---------- 导航 ---------- */
  var MAX_TABS = 5;   // 底部导航最多放几项（含「更多」）

  /** 启用的模块（今日与设置始终保留，避免没有入口） */
  function enabledViews() {
    var cfg = (Store.state.settings && Store.state.settings.nav) || {};
    return App.views.filter(function (v) {
      if (v.nav === false) return false;
      if (v.id === 'today' || v.id === 'settings') return true;
      return cfg[v.id] !== false;
    });
  }

  function buildNav() {
    var nav = UI.$('#nav');
    var tabbar = UI.$('#tabbar');
    nav.innerHTML = '';
    tabbar.innerHTML = '';

    var list = enabledViews();

    // 侧边栏：全部启用项
    list.forEach(function (v) {
      nav.appendChild(UI.el('button', {
        class: 'nav-item', id: 'nav-' + v.id,
        onclick: function () { go(v.id); }
      }, [UI.svg(v.icon, 20), UI.el('span', { text: v.name })]));
    });

    // 底部栏：超过 MAX_TABS 时把多余的收进「更多」
    var shown = list;
    if (list.length > MAX_TABS) shown = list.slice(0, MAX_TABS - 1);
    shown.forEach(function (v) {
      tabbar.appendChild(UI.el('button', {
        class: 'tabbar-item', id: 'tab-' + v.id,
        onclick: function () { go(v.id); }
      }, [UI.svg(v.icon, 22), UI.el('span', { text: v.name })]));
    });

    if (list.length > MAX_TABS) {
      var rest = list.slice(MAX_TABS - 1);
      tabbar.appendChild(UI.el('button', {
        class: 'tabbar-item', id: 'tab-more',
        onclick: function () { openMoreMenu(rest); }
      }, [UI.svg(moreIcon(), 22), UI.el('span', { text: '更多' })]));
    }
  }

  function moreIcon() {
    return ['M6 12h.01M12 12h.01M18 12h.01'];
  }

  /** 收起来的模块：弹窗列出 */
  function openMoreMenu(rest) {
    var m;
    var box = UI.el('div', { class: 'more-grid' });
    rest.forEach(function (v) {
      box.appendChild(UI.el('button', {
        class: 'more-item', onclick: function () { m.close(); go(v.id); }
      }, [
        UI.svg(v.icon, 24),
        UI.el('span', { text: v.name })
      ]));
    });
    m = UI.modal({ title: '更多模块', body: box });
  }

  function badge(id, count) {
    ['#nav-', '#tab-'].forEach(function (sel) {
      var node = UI.$(sel + id);
      if (!node) return;
      var old = UI.$('.cp-badge, .cp-dot', node);
      if (old) old.remove();
      if (count > 0) {
        node.appendChild(UI.el('span', {
          class: sel === '#nav-' ? 'badge' : 'dot',
          text: sel === '#nav-' ? String(count) : ''
        }));
      }
    });
  }

  /* ---------- 路由 ---------- */
  function go(id) {
    var v = App.views.filter(function (x) { return x.id === id; })[0];
    if (!v) return;

    App.currentId = id;
    App.current = v;

    UI.$$('.cp-view').forEach(function (n) { n.classList.remove('cp-active'); });
    if (!v.root) v.mount(UI.$('#views'));
    v.root.classList.add('cp-active');

    if (v.onEnter) v.onEnter();
    else if (v.render) v.render();

    markActive(id);

    UI.$('#viewTitle').textContent = v.title || v.name;

    // 重建该视图的操作按钮区
    var actions = UI.$('#viewActions');
    actions.innerHTML = '';
    if (v.actions) v.actions(actions);

    closeDrawer();
    UI.$('#views').scrollTop = 0;
  }

  /* ---------- 抽屉 ---------- */
  function openDrawer() {
    UI.$('#sidebar').classList.add('cp-open');
    UI.$('#scrim').classList.add('cp-show');
    UI.$('#scrim').onclick = closeDrawer;
  }
  function closeDrawer() {
    UI.$('#sidebar').classList.remove('cp-open');
    UI.$('#scrim').classList.remove('cp-show');
    UI.$('#scrim').onclick = function () { UI.topClose && UI.topClose(); };
  }

  /* ---------- 学期卡片 ---------- */
  function renderTermCard() {
    var box = UI.$('#termCard');
    var s = Store.semester;
    var cw = Store.currentWeek();
    var inTerm = cw >= 1 && cw <= s.weeks;
    var total = Store.courses.length;
    // 角标只数顶层任务：子任务是父任务的一部分，否则「1 件事 3 步」会显示成 4
    var pendingTasks = Store.rootPending().length;
    var start = Store.weekStartDate(1);
    var end = DateUtil.addDays(Store.weekStartDate(s.weeks), 6);

    box.innerHTML =
      '<b>' + UI.escapeHTML(s.name) + '</b>' +
      '<div class="cp-term-row"><span>学期起止</span><span>' + DateUtil.mdShort(start) + ' – ' + DateUtil.mdShort(end) + '</span></div>' +
      '<div class="cp-term-row"><span>当前周次</span><span>' + (inTerm ? '第 ' + cw + ' 周' : '假期中') + '</span></div>' +
      '<div class="cp-term-row"><span>课程 / 待办</span><span>' + total + ' / ' + pendingTasks + '</span></div>';
    UI.$('#brandSub').textContent = DateUtil.weekdayCN(DateUtil.today()) + ' · ' + DateUtil.toStr(DateUtil.today()).slice(5);
  }

  /* ---------- 启动 ---------- */
  async function boot() {
    await Store.init();

    // 离线 PWA：仅 http(s) 部署后生效；file:// 直接双击打开时自动跳过
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator &&
        (location.protocol === 'http:' || location.protocol === 'https:')) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      });
    }

    window.Pet.init();
    // 页面内上课提醒：只在页面可见时跑，不申请任何权限
    if (global.Remind) Remind.start();
    if (global.Theme) { Theme.apply(); Theme.applyBackground(); }
    sortViews();
    buildNav();

    App.views.forEach(function (v) {
      if (v.init) v.init();
    });

    Store.subscribe(function () {
      renderTermCard();
      badge('tasks', Store.rootPending().length);
      if (App.current && App.current.render && !App.current.noAutoRender) App.current.render();
      App.views.forEach(function (v) { if (v.onDataChange) v.onDataChange(); });
    });

    var drawerBtn = UI.$('#btnDrawer');
    if (drawerBtn) drawerBtn.addEventListener('click', openDrawer);

    // 全局搜索：顶栏按钮 + Ctrl/⌘ + K
    var searchBtn = UI.$('#btnSearch');
    if (searchBtn) searchBtn.addEventListener('click', function () {
      if (global.Search) Search.open();
    });
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        if (!global.Search) return;
        e.preventDefault();
        Search.open();
      }
    });

    if (!Store.storageOK) {
      var warn = UI.el('div', {
        class: 'storage-warn',
        text: '当前预览环境禁用了本地存储，本次修改可能不会保存。建议在浏览器中直接打开本文件，或使用发布后的在线链接。'
      });
      var mainEl = UI.$('.cp-main');
      mainEl.insertBefore(warn, UI.$('#views'));
    }

    renderTermCard();
    badge('tasks', Store.rootPending().length);
    var first = App.views[0] ? App.views[0].id : null;
    if (first) go(first);

    // 第一次打开：走一遍新手教程（结束后停在课程表，方便直接排课）
    if (!Store.state.settings.guided && global.Onboard) {
      setTimeout(function () { Onboard.start(); }, 420);
    }
  }

  function markActive(id) {
    UI.$$('.cp-nav-item').forEach(function (n) { n.classList.remove('cp-active'); });
    UI.$$('.cp-tabbar-item').forEach(function (n) { n.classList.remove('cp-active'); });
    var a1 = UI.$('#nav-' + id);
    if (a1) a1.classList.add('cp-active');
    var a2 = UI.$('#tab-' + id);
    if (a2) a2.classList.add('cp-active');
    else {
      var more = UI.$('#tab-more');
      if (more) more.classList.add('cp-active');
    }
  }

  App.go = go;
  App.badge = badge;
  App.buildNav = function () { buildNav(); markActive(App.currentId); };
  /* ===================== 龙泡泡桌宠（开发者/自用） ===================== */
  

  App.renderTermCard = renderTermCard;
  global.App = App;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else boot();
})(window);


