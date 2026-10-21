

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
  /**
   * 切到某个视图
   * @param {string} id  视图 id
   * @param {Object} [opts] { tab: 'diary' } —— 深链接进来时顺带切到某个分页
   */
  function go(id, opts) {
    opts = opts || {};
    var v = App.views.filter(function (x) { return x.id === id; })[0];
    if (!v) return;

    App.currentId = id;
    App.current = v;

    // 进入模块只记活跃痕迹；月卡返还与全勤改由「完成有效动作」触发（Store.markAction）
    if (Store.touchActive) Store.touchActive();

    UI.$$('.cp-view').forEach(function (n) { n.classList.remove('cp-active'); });
    if (!v.root) v.mount(UI.$('#views'));
    v.root.classList.add('cp-active');

    if (v.onEnter) v.onEnter();
    else if (v.render) v.render();

    // 深链接带分页（#/tasks/diary）：先渲染再切分页，setTab 内部会再渲染一次。
    // 地址里没带分页（#/tasks）则回到该页默认分页——地址写得越明确，越该按它来。
    if (opts.tab && v.setTab) v.setTab(opts.tab);
    else if (opts.fromUrl && v.setTab) v.setTab(null);

    markActive(id);

    UI.$('#viewTitle').textContent = v.title || v.name;

    // 重建该视图的操作按钮区
    var actions = UI.$('#viewActions');
    actions.innerHTML = '';
    if (v.actions) v.actions(actions);

    // 地址栏同步：视图自己知道当前分页就带上，链接复制出去才对得上
    if (global.Router) {
      var tab = (opts.tab && v.setTab) ? opts.tab : (v.getTab ? v.getTab() : null);
      Router.set(id, routeTab(v, tab));
    }

    UI.$('#views').scrollTop = 0;
  }

  /** 地址栏里该带哪个分页：默认分页不写尾巴（#/tasks 比 #/tasks/tasks 干净） */
  function routeTab(v, tab) {
    return (tab && v && tab === v.defaultTab) ? null : (tab || null);
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

  /* ---------- 侧边栏折叠（仅桌面） ---------- */
  /** 把设置里的折叠状态贴到 DOM；首屏渲染前调用，避免先撑开再收起 */
  function applySidebarMini() {
    var ui = Store.state.settings.ui || {};
    var mini = !!ui.sidebarMini;
    var app = document.querySelector('.cp-app');
    if (app) app.classList.toggle('cp-mini', mini);
    var btn = UI.$('#btnCollapse');
    if (btn) {
      btn.title = mini ? '展开侧边栏' : '折叠侧边栏';
      btn.setAttribute('aria-label', btn.title);
    }
  }

  function toggleSidebarMini() {
    var s = Store.state.settings;
    if (!s.ui) s.ui = { sidebarMini: false };
    s.ui.sidebarMini = !s.ui.sidebarMini;
    Store.save();
    applySidebarMini();
  }

  /* ---------- 启动 ---------- */
  /**
   * manifest 与图标是可选伴侣文件（和 sw.js 一样），单文件转发时并不在场。
   * 直接写死 <link rel="manifest"> 会在控制台留一条 404，所以在 http(s) 下先探一下。
   */
  function installManifest() {
    if (!/^https?:$/.test(location.protocol || '')) return;
    if (document.querySelector('link[rel="manifest"]')) return;
    fetch('manifest.webmanifest', { method: 'HEAD' }).then(function (res) {
      if (!res || !res.ok) return;
      var link = document.createElement('link');
      link.rel = 'manifest';
      link.href = 'manifest.webmanifest';
      document.head.appendChild(link);
    }).catch(function () {});
  }

  /**
   * PWA 更新提示：新 SW 被安装并接管（skipWaiting + clients.claim）后会触发
   * controllerchange——此时页面跑的还是旧 HTML，弹一个可点击刷新的常驻 Toast。
   * 首次安装（加载时本来就没有 controller 接管）不算更新，不弹。
   */
  function watchSwUpdate() {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController) { hadController = true; return; }
      if (document.getElementById('cpUpdateToast')) return;
      var btn = UI.el('button', { class: 'update-btn', onclick: function () { location.reload(); } }, ['立即刷新']);
      var node = UI.el('div', { class: 'toast info', id: 'cpUpdateToast' }, [
        UI.el('span', { text: '应用已更新' }),
        btn
      ]);
      document.getElementById('toastRoot').appendChild(node);
      setTimeout(function () {
        if (!node.parentNode) return;
        node.classList.add('cp-out');
        setTimeout(function () { node.remove(); }, 220);
      }, 15000);
    });
  }

  /** load 事件可能在 boot() 完成前就已触发，这里做兼容（否则 SW 永远不注册） */
  function onReady(fn) {
    if (document.readyState === 'complete') fn();
    else window.addEventListener('load', fn);
  }

  async function boot() {
    await Store.init();

    // 离线 PWA：仅 http(s) 部署后生效；file:// 直接双击打开时自动跳过
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator &&
        (location.protocol === 'http:' || location.protocol === 'https:')) {
      onReady(function () {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      });
      watchSwUpdate();
    }
    installManifest();

    window.Pet.init();
    // 页面内上课提醒：只在页面可见时跑，不申请任何权限
    if (global.Remind) Remind.start();
    if (global.Theme) { Theme.apply(); Theme.applyBackground(); }
    applySidebarMini();
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

    // 全局搜索：顶栏按钮 + Ctrl/⌘ + K
    var collapseBtn = UI.$('#btnCollapse');
    if (collapseBtn) collapseBtn.addEventListener('click', toggleSidebarMini);

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

    // 深链接：地址里带 #/today 之类的就从那个视图开始，否则用排序后的第一个
    var ids = App.views.map(function (v) { return v.id; });
    var startRoute = global.Router ? Router.initial(ids) : null;
    var startId = startRoute ? startRoute.id : (App.views[0] ? App.views[0].id : null);
    if (startId) go(startId, { tab: startRoute && startRoute.tab, fromUrl: true });

    // 地址栏被手改、或点了前进/后退时切视图
    if (global.Router) {
      Router.start(function () { return App.views.map(function (v) { return v.id; }); }, function (r) {
        go(r.id, { tab: r.tab, fromUrl: true });
      });
      // 地址认不出来（手改错字）：把地址修回当前页，免得复制出去还是坏的
      Router.onInvalid = function () {
        var v = App.current;
        Router.set(App.currentId, v ? routeTab(v, v.getTab ? v.getTab() : null) : null);
      };
    }

    // 第一次打开：走一遍新手教程，结束后回到进来时那一页（默认课程表，方便直接排课）
    if (!Store.state.settings.guided && global.Onboard) {
      setTimeout(function () {
        Onboard.start(startRoute ? { from: startRoute.id, fromTab: startRoute.tab } : {});
      }, 420);
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

  /* ---------- 安装到桌面 ---------- */
  // Chrome / Edge 会抛 beforeinstallprompt，先拦下来，设置页的按钮再放行；
  // iOS Safari 没有这个事件，只能靠「分享 → 添加到主屏幕」，所以那边给文字引导。
  var installEvent = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installEvent = e;
  });
  App.installReady = function () { return !!installEvent; };
  App.promptInstall = function () {
    if (!installEvent) return false;
    var e = installEvent;
    installEvent = null;
    e.prompt();
    return true;
  };
  /** 已经以「独立窗口」跑着（装到桌面后从图标启动） */
  App.isStandalone = function () {
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    } catch (e) { /* 老浏览器不支持 matchMedia 的该查询 */ }
    return !!(navigator && navigator.standalone);
  };

  global.App = App;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else boot();
})(window);


