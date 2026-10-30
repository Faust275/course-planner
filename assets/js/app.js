

/* ==========================================================
 * App 主控：路由、导航、渲染调度
 * ========================================================== */
(function (global) {
  'use strict';

  /** 与 android/app/build.gradle 的 versionName 保持一致；用于「一次性提示」的版本键。 */
  var APP_VERSION = '1.4.17';

  var App = {
    views: [],
    current: null,
    currentId: 'schedule',
    version: APP_VERSION,

    /* ---------- 跨视图通信总线 ----------
       取代散落在各处的 window.__cp* 私有全局变量，统一挂在 App 下，
       避免「一个视图往 window 上挂个字段、另一个视图去读」这种隐式契约。
       目前承载「待办 → 日历」的接力高亮。 */
    bus: {
      _relay: null,                 // { taskId, at }

      /** 把一条待办「接力」给目标视图（跳过去后高亮它） */
      setRelay: function (taskId) {
        this._relay = taskId ? { taskId: taskId, at: Date.now() } : null;
      },

      /** 取接力信息；超过 maxAgeMs 视为过期并丢弃。
          取到后**不**立刻清空：进入视图时 mount + onEnter 会连着渲染两次，
          两次都要命中，所以由 clearRelay(at) 在渲染收尾时显式清。 */
      peekRelay: function (maxAgeMs) {
        var r = this._relay;
        if (!r || !r.taskId) return null;
        if (Date.now() - r.at > (maxAgeMs || 8000)) { this._relay = null; return null; }
        return r;
      },

      /** 消费掉接力标记；传 at 时只在标记未被替换的情况下清，防止误清新接力 */
      clearRelay: function (at) {
        if (this._relay && (at == null || this._relay.at === at)) this._relay = null;
      }
    }
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

  /* ---------- 导航（方案 A：五大核心分区聚合架构 ⇄ 经典多模块模式可切换） ---------- */
  var MAX_TABS = 5;   // 经典模式下底部导航最多放几项（含「更多」）
  var _hubMemory = {}; // 记录每个大分区上次停留的 { id, tab }

  /** 六大核心分区定义（方案 A 六栏架构：今日 · 课表 · 待办 · 计划 · 专注 · 我的） */
  var HUB_PARTITIONS = [
    {
      id: 'today',
      name: '今日',
      subLabel: '今日 · 健康',
      icon: function () { return UI.icons.today; },
      views: ['today', 'health'],
      items: function () {
        return [
          { label: '☀️ 今日总览', view: 'today', tab: null, isAct: function (cid) { return cid === 'today'; } },
          { label: '❤️ 健康概览', view: 'health', tab: 'overview', isAct: function (cid, t) { return cid === 'health' && (!t || t === 'overview'); } },
          { label: '🏃 活动与步数', view: 'health', tab: 'activity', isAct: function (cid, t) { return cid === 'health' && t === 'activity'; } },
          { label: '🏋️ 锻炼记录', view: 'health', tab: 'workout', isAct: function (cid, t) { return cid === 'health' && t === 'workout'; } }
        ];
      }
    },
    {
      id: 'schedule',
      name: '课表',
      subLabel: '课表 · 所学 · 日历 · 备考',
      icon: function () { return UI.icons.calendar; },
      views: ['schedule', 'calendar'],
      items: function () {
        var nLogs = (Store.courseLogs && Store.courseLogs.length) ? Store.courseLogs.length : 0;
        return [
          { label: '📅 周课表', view: 'schedule', tab: 'table', isAct: function (cid, t) { return cid === 'schedule' && t !== 'exam' && t !== 'logs'; } },
          { label: '📖 课堂所学' + (nLogs ? ' ' + nLogs : ''), view: 'schedule', tab: 'logs', isAct: function (cid, t) { return cid === 'schedule' && t === 'logs'; } },
          { label: '🗓️ 月历与长条', view: 'calendar', tab: 'calendar', isAct: function (cid) { return cid === 'calendar'; } },
          { label: '🎯 备考看板', view: 'schedule', tab: 'exam', isAct: function (cid, t) { return cid === 'schedule' && t === 'exam'; } }
        ];
      }
    },
    {
      id: 'tasks',
      name: '待办',
      subLabel: '待办日程 · 象限统计 · 灵感 · 日记',
      icon: function () { return UI.icons.check; },
      views: ['tasks'],
      items: function () {
        var nt = (Store.notes || []).length;
        var nd = (Store.state && Store.state.diaries ? Store.state.diaries.length : 0);
        return [
          { label: '✅ 待办与日程', view: 'tasks', tab: 'tasks', isAct: function (cid, t) { return cid === 'tasks' && (!t || t === 'tasks'); } },
          { label: '🧭 象限与统计', view: 'tasks', tab: 'quadrant', isAct: function (cid, t) { return cid === 'tasks' && (t === 'quadrant' || t === 'stats'); } },
          { label: '💡 灵感便签' + (nt ? ' ' + nt : ''), view: 'tasks', tab: 'notes', isAct: function (cid, t) { return cid === 'tasks' && t === 'notes'; } },
          { label: '📔 个人日记' + (nd ? ' ' + nd : ''), view: 'tasks', tab: 'diary', isAct: function (cid, t) { return cid === 'tasks' && t === 'diary'; } }
        ];
      }
    },
    {
      id: 'plans',
      name: '计划',
      subLabel: '目标 · 习惯 · 月历',
      icon: function () { return UI.icons.flag; },
      views: ['plans'],
      items: function () {
        var ng = (Store.goalsActive ? Store.goalsActive().length : 0);
        var np = (Store.activePlans ? Store.activePlans().length : (Store.plans || []).length);
        return [
          { label: '🎯 目标(OKR)' + (ng ? ' ' + ng : ''), view: 'plans', tab: 'goals', isAct: function (cid, t) { return cid === 'plans' && t === 'goals'; } },
          { label: '📅 习惯打卡' + (np ? ' ' + np : ''), view: 'plans', tab: 'plans', isAct: function (cid, t) { return cid === 'plans' && (!t || t === 'plans'); } },
          { label: '🗓️ 计划月历', view: 'plans', tab: 'month', isAct: function (cid, t) { return cid === 'plans' && t === 'month'; } }
        ];
      }
    },
    {
      id: 'pomodoro',
      name: '专注',
      subLabel: '番茄 · 森林 · 收集',
      icon: function () { return UI.icons.tomato; },
      views: ['pomodoro', 'collection'],
      items: function () {
        var isAcad = Store.isAcademicMode && Store.isAcademicMode();
        var gachaOn = Store.gachaEnabled && Store.gachaEnabled();
        var pm = Store.pomodoro || { mode: 'forest', trees: [] };
        var arr = [
          { label: '🍅 番茄专注', view: 'pomodoro', tab: null, isAct: function (cid) { return cid === 'pomodoro'; } }
        ];
        if (!isAcad) {
          arr.push(
            { label: '🌲 森林' + (pm.trees && pm.trees.length ? ' ' + pm.trees.length : ''), view: 'collection', tab: 'forest', isAct: function (cid, t) { return cid === 'collection' && (!t || t === 'forest'); } },
            { label: '⛺ 商店', view: 'collection', tab: 'shop', isAct: function (cid, t) { return cid === 'collection' && t === 'shop'; } }
          );
          if (gachaOn && pm.mode !== 'forest') {
            arr.push({ label: '🎴 干员图鉴', view: 'collection', tab: 'ops', isAct: function (cid, t) { return cid === 'collection' && t === 'ops'; } });
          }
          arr.push({ label: '🏆 成就', view: 'collection', tab: 'ach', isAct: function (cid, t) { return cid === 'collection' && t === 'ach'; } });
        }
        return arr;
      }
    },
    {
      id: 'settings',
      name: '我的',
      subLabel: '记账 · 成绩 · 设置',
      icon: function () { return UI.icons.settings; },
      views: ['settings', 'ledger', 'grades'],
      items: function () {
        return [
          { label: '💰 记账账本', view: 'ledger', tab: null, isAct: function (cid) { return cid === 'ledger'; } },
          { label: '🎓 成绩绩点', view: 'grades', tab: null, isAct: function (cid) { return cid === 'grades'; } },
          { label: '❤️ 健康看板', view: 'health', tab: 'overview', isAct: function (cid) { return cid === 'health'; } },
          { label: '⚙️ 系统设置', view: 'settings', tab: null, isAct: function (cid) { return cid === 'settings'; } }
        ];
      }
    }
  ];

  function hubOfView(viewId, tab) {
    for (var i = 0; i < HUB_PARTITIONS.length; i++) {
      if (HUB_PARTITIONS[i].views.indexOf(viewId) >= 0) return HUB_PARTITIONS[i];
    }
    return HUB_PARTITIONS[0];
  }

  function isHub5Mode() {
    return !Store.getNavLayout || Store.getNavLayout() !== 'classic';
  }

  /** 启用的模块（今日与设置始终保留，避免没有入口） */
  function enabledViews() {
    var cfg = (Store.state.settings && Store.state.settings.nav) || {};
    return App.views.filter(function (v) {
      if (v.nav === false) return false;
      if (v.id === 'today' || v.id === 'settings') return true;
      // 健康看板有独立总开关（settings.healthOn）：默认关，没开启就不占导航位。
      // 只是不显示入口，#/health 深链接仍然能进，书签不会失效。
      if (v.id === 'health' && !(Store.healthEnabled && Store.healthEnabled())) return false;
      // 纯粹学术专注模式下自动隐藏游戏化收集与抽卡导航项
      if ((v.id === 'collection' || v.id === 'gacha') && Store.isAcademicMode && Store.isAcademicMode()) return false;
      return cfg[v.id] !== false;
    });
  }

  function buildNav() {
    var nav = UI.$('#nav');
    var tabbar = UI.$('#tabbar');
    nav.innerHTML = '';
    tabbar.innerHTML = '';

    var list = enabledViews();

    // 桌面端侧边栏（#nav）：在六大分区模式下按六大核心分区归类分组并附带快捷子项，经典模式下平铺展示
    if (isHub5Mode()) {
      var renderedViewIds = {};
      HUB_PARTITIONS.forEach(function (hub) {
        var grp = UI.el('div', { class: 'cp-desk-nav-group', dataset: { hubGroup: hub.id } });
        grp.appendChild(UI.el('div', {
          class: 'cp-desk-nav-group-head',
          text: hub.name + ' · ' + hub.subLabel
        }));
        hub.views.forEach(function (vid) {
          var vObj = list.filter(function (x) { return x.id === vid; })[0];
          if (!vObj || renderedViewIds[vid]) return;
          renderedViewIds[vid] = true;
          grp.appendChild(UI.el('button', {
            class: 'nav-item', id: 'nav-' + vObj.id, dataset: { view: vObj.id, hub: hub.id },
            onclick: function () { go(vObj.id); }
          }, [UI.svg(vObj.icon, 20), UI.el('span', { text: vObj.name })]));
        });
        nav.appendChild(grp);
      });
      // 兜底：任何未在 HUB_PARTITIONS.views 里的启用视图也补上（确保所有 #nav-<id> 节点齐全）
      list.forEach(function (v) {
        if (renderedViewIds[v.id]) return;
        renderedViewIds[v.id] = true;
        nav.appendChild(UI.el('button', {
          class: 'nav-item', id: 'nav-' + v.id, dataset: { view: v.id },
          onclick: function () { go(v.id); }
        }, [UI.svg(v.icon, 20), UI.el('span', { text: v.name })]));
      });
    } else {
      list.forEach(function (v) {
        nav.appendChild(UI.el('button', {
          class: 'nav-item', id: 'nav-' + v.id, dataset: { view: v.id },
          onclick: function () { go(v.id); }
        }, [UI.svg(v.icon, 20), UI.el('span', { text: v.name })]));
      });
    }

    if (isHub5Mode()) {
      // 方案 A（六大核心分区整合模式）：底部栏固定摆放 6 个大分区（今日 / 课表 / 待办 / 计划 / 专注 / 我的），完全无需「更多模块」折叠弹窗
      HUB_PARTITIONS.forEach(function (hub) {
        tabbar.appendChild(UI.el('button', {
          class: 'tabbar-item cp-hub-tabbar-item',
          id: 'tab-' + hub.id,
          dataset: { view: hub.id, hub: hub.id },
          title: hub.name + '（' + hub.subLabel + '）',
          onclick: function () {
            var curTab = (App.current && typeof App.current.getTab === 'function') ? App.current.getTab() : null;
            var curHub = hubOfView(App.currentId, curTab);
            if (curHub && curHub.id === hub.id) {
              // 已在当前分区：再次点击回到该分区的首选主视图
              go(hub.id);
              return;
            }
            var mem = _hubMemory[hub.id];
            if (mem && mem.id) {
              go(mem.id, mem.tab ? { tab: mem.tab } : null);
            } else {
              go(hub.id);
            }
          }
        }, [UI.svg(hub.icon(), 22), UI.el('span', { text: hub.name })]));
      });
    } else {
      // 经典独立模块模式：超过 MAX_TABS 时把多余的收进「更多」
      var shown = list;
      if (list.length > MAX_TABS) shown = list.slice(0, MAX_TABS - 1);
      shown.forEach(function (v) {
        tabbar.appendChild(UI.el('button', {
          class: 'tabbar-item', id: 'tab-' + v.id, dataset: { view: v.id },
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
    renderHubBar();
  }

  /** 渲染五大分区顶部二级聚合切换条（#hubBar） */
  function renderHubBar() {
    var mainEl = UI.$('.cp-main');
    var viewsEl = UI.$('#views');
    if (!mainEl || !viewsEl) return;
    var bar = document.getElementById('hubBar');
    if (!bar) {
      bar = UI.el('div', { class: 'cp-hub-bar', id: 'hubBar' });
      mainEl.insertBefore(bar, viewsEl);
    }
    bar.innerHTML = '';
    if (!isHub5Mode()) {
      bar.style.display = 'none';
      return;
    }
    var curId = App.currentId || 'schedule';
    // 待办(tasks)、计划(plans)、健康(health)、收集(collection) 视图内部顶部已自带完整的两排二级切换栏，
    // 直接移除外层重复的 #hubBar 显示，确保任何页面永远只有一层二级导航栏
    if (curId === 'tasks' || curId === 'plans' || curId === 'health' || curId === 'collection') {
      bar.style.display = 'none';
      return;
    }
    var curView = App.current;
    var curTab = (curView && typeof curView.getTab === 'function') ? curView.getTab() : null;
    var hub = hubOfView(curId, curTab);
    if (!hub) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';
    var items = hub.items ? hub.items() : [];
    var track = UI.el('div', { class: 'cp-hub-bar-track' });
    items.forEach(function (it) {
      var act = it.isAct ? it.isAct(curId, curTab) : (curId === it.view && (!it.tab || curTab === it.tab));
      track.appendChild(UI.el('button', {
        class: 'cp-hub-chip' + (act ? ' cp-active' : ''),
        type: 'button',
        onclick: function () {
          _hubMemory[hub.id] = { id: it.view, tab: it.tab || null };
          if (App.currentId === it.view && App.current && typeof App.current.setTab === 'function' && it.tab) {
            App.current.setTab(it.tab);
            renderHubBar();
          } else {
            go(it.view, it.tab ? { tab: it.tab } : null);
          }
        }
      }, [it.label]));
    });
    bar.appendChild(track);
  }

  App.renderHubBar = renderHubBar;
  App.HUB_PARTITIONS = HUB_PARTITIONS;

  function moreIcon() {
    return ['M6 12h.01M12 12h.01M18 12h.01'];
  }

  /** 收起来的模块：弹窗列出（仅经典导航模式使用，底部附带一键切换为五大分区按钮） */
  function openMoreMenu(rest) {
    var m;
    var wrap = UI.el('div', {});
    var box = UI.el('div', { class: 'more-grid' });
    rest.forEach(function (v) {
      box.appendChild(UI.el('button', {
        class: 'more-item', onclick: function () { m.close(); go(v.id); }
      }, [
        UI.svg(v.icon, 24),
        UI.el('span', { text: v.name })
      ]));
    });
    wrap.appendChild(box);
    wrap.appendChild(UI.el('div', {
      style: { marginTop: '12px', paddingTop: '10px', borderTop: '1px dashed var(--line)', textAlign: 'center' }
    }, [
      UI.el('button', {
        class: 'btn btn-primary btn-block',
        onclick: function () {
          m.close();
          if (Store.setNavLayout) Store.setNavLayout('hub5');
          App.rebuildNav();
          UI.toast('已开启「方案 A：六大核心分区整合模式」，底部栏不再折叠为更多弹窗', 'ok');
        }
      }, ['🌟 切换为「六大分区整合模式（方案 A）」'])
    ]));
    m = UI.modal({ title: '更多模块', body: wrap });
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
    if (id === 'gacha' && !opts.fromUrl && global.Gacha && typeof Gacha.open === 'function' &&
        (!Store.isAcademicMode || !Store.isAcademicMode()) && Store.gachaEnabled && Store.gachaEnabled()) {
      Gacha.open();
      return;
    }
    var v = App.views.filter(function (x) { return x.id === id; })[0];
    if (!v && global.Router && Router.ALIAS && Router.ALIAS[id]) {
      var al = Router.ALIAS[id];
      id = al.id;
      if (!opts.tab && al.tab) opts = Object.assign({}, opts, { tab: al.tab });
      v = App.views.filter(function (x) { return x.id === id; })[0];
    }
    if (!v) return;

    App.currentId = id;
    App.current = v;

    // 进入模块只记活跃痕迹；月卡返还与全勤改由「完成有效动作」触发（Store.markAction）
    if (Store.touchActive) Store.touchActive();

    var bootSk = document.getElementById('bootSkeleton');
    if (bootSk && bootSk.parentNode) bootSk.parentNode.removeChild(bootSk);
    UI.$$('.cp-view').forEach(function (n) { n.classList.remove('cp-active'); });
    var targetTab = opts.tab ? opts.tab : (opts.fromUrl ? null : undefined);
    var willSetTab = targetTab !== undefined && typeof v.setTab === "function";

    if (!v.root) {
      if (willSetTab) {
        v.setTab(targetTab);
      }
      v.mount(UI.$("#views"));
    }
    v.root.classList.add("cp-active");

    if (willSetTab) {
      v.setTab(targetTab);
    } else {
      if (v.onEnter) v.onEnter();
      else if (v.render) v.render();
    }

    markActive(id);

    UI.$('#viewTitle').textContent = v.title || v.name;

    // 重建该视图的操作按钮区
    var actions = UI.$('#viewActions');
    if (UI.cleanupMenus) UI.cleanupMenus();   // 顶栏下拉面板挂在 body 上，按钮要销毁了得一起收
    actions.innerHTML = '';
    if (v.actions) v.actions(actions);

    // 地址栏同步：视图自己知道当前分页就带上，链接复制出去才对得上
    if (global.Router) {
      var tab = (opts.tab && v.setTab) ? opts.tab : (v.getTab ? v.getTab() : null);
      Router.set(id, routeTab(v, tab));
    }

    if (UI.labelFields) UI.labelFields(UI.$('#views'));
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
    // 学期切换：回看旧学期的课表 / 成绩 / 统计（数据早就在，缺个入口）
    if ((Store.semesters || []).length > 1) {
      box.appendChild(UI.el('button', {
        class: 'chip term-switch',
        type: 'button',
        'aria-label': '切换学期，当前为 ' + s.name,
        style: { marginTop: '8px', cursor: 'pointer', border: 'none' },
        text: '切换学期',
        onclick: openSemesterMenu
      }));
    }
    UI.$('#brandSub').textContent = DateUtil.weekdayCN(DateUtil.today()) + ' · ' + DateUtil.toStr(DateUtil.today()).slice(5);
  }

  /** 侧边栏「切换学期」菜单：选中即切换，课表 / 成绩 / 统计跟着换 */
  function openSemesterMenu() {
    var list = Store.semesters || [];
    var items = list.map(function (s) {
      return {
        label: s.name + (s.id === Store.currentSemesterId ? '（当前）' : ''),
        hint: [s.startDate || '', (s.weeks || 20) + ' 周'].filter(Boolean).join(' · '),
        onClick: function () {
          if (s.id === Store.currentSemesterId) return;
          Store.switchSemester(s.id);
          UI.toast('已切换到「' + s.name + '」');
          if (App.current && App.current.render) App.current.render();
        }
      };
    });
    if (UI.moveMenu) UI.moveMenu('切换学期', items);
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
    var existing = document.querySelector('link[rel="manifest"]');
    if (!/^https?:$/.test(location.protocol || '') || window.__isFileProtocolSim) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return;
    }
    if (existing) return;
    var link = document.createElement('link');
    link.rel = 'manifest';
    link.href = 'manifest.webmanifest';
    document.head.appendChild(link);
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
      var btn = UI.el('button', { class: 'update-btn', onclick: function () { if (global.Store && Store.flushSave) Store.flushSave(); location.reload(); } }, ['立即刷新']);
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

  /* ---------- 安卓硬件返回键 ----------
   * 打包成 App 后，WebView 默认行为是「直接退出」，体验很差。
   * 这里改成三级递进：有弹窗/浮层 → 关掉最上层；否则退回上一个视图；
   * 已经在主视图（历史里没有上一步）才真正退出。
   * 浏览器里没有 Capacitor，这段代码自动跳过，不影响 Web 行为。 */
  function setupAndroidBackButton() {
    try {
      var AppPlugin = global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.App;
      if (!AppPlugin || !AppPlugin.addListener) return;

      AppPlugin.addListener('backButton', function () {
        // 1) 弹窗 / 截图对话框 / 移动菜单：关掉最上层
        if (UI.topClose && document.querySelector('.cp-modal-wrap')) { UI.topClose(); return; }
        var float = document.querySelector('.cp-shot, .cp-move-menu, .cp-ob-mask');
        if (float) {
          var btn = float.querySelector('.cp-icon-btn, .cp-btn');
          if (btn) { btn.click(); return; }
        }
        // 2) 有上一步就后退
        if (window.history && window.history.length > 1) { window.history.back(); return; }
        // 3) 主视图：退出
        if (AppPlugin.exitApp) AppPlugin.exitApp();
      });
    } catch (e) { /* 非安卓环境忽略 */ }
  }

  function applyTopSafeArea() {
    try {
      var docEl = document.documentElement;
      if (!docEl) return;
      var ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
      var isCap = !!(global.Capacitor || global.AndroidBridge);
      var isAnd = isCap || /Android/i.test(ua);
      docEl.classList.toggle('cp-is-capacitor', isCap);
      docEl.classList.toggle('cp-is-android', isAnd);
      var pref = (Store.state && Store.state.settings && Store.state.settings.topSafeInset) || 'auto';
      if (pref === 'spacious' || pref === 'compact') {
        docEl.setAttribute('data-top-safe', pref);
      } else {
        docEl.removeAttribute('data-top-safe');
      }
    } catch (e) {}
  }
  App.applyTopSafeArea = applyTopSafeArea;

  /* ---------- 诊断用错误环形缓冲 ----------
   * 只留在内存里（最多 20 条），随「设置 → 数据管理 → 导出诊断包」一起导出。
   * 用户报「数据没了 / 白屏」时，这是唯一能拿到现场线索的东西。 */
  function initErrorBuffer() {
    var buf = window.__cpErrors = window.__cpErrors || [];
    function push(kind, msg, extra) {
      buf.push({ at: new Date().toISOString(), kind: kind, msg: String(msg || '').slice(0, 300), extra: String(extra || '').slice(0, 200) });
      if (buf.length > 20) buf.shift();
    }
    window.addEventListener('error', function (ev) {
      push('error', ev && ev.message, ev && ev.filename ? ev.filename + ':' + (ev.lineno || '') : '');
    });
    window.addEventListener('unhandledrejection', function (ev) {
      var r = ev && ev.reason;
      push('rejection', r && (r.message || r), r && r.stack ? String(r.stack).split('\n')[1] : '');
    });
  }
  initErrorBuffer();

  /* =====================================================================
   * 启动兜底 / 坏档提示 / 通知权限一次性提示
   * ---------------------------------------------------------------------
   * 以前 boot() 只有 Store.init() 外面有 try/catch，后续任何一处抛错都会
   * 停在「正在加载」骨架屏，用户连导出诊断的入口都摸不到。这里补三件事：
   *   1) boot 整体兜底，失败时给出重试与导出诊断；
   *   2) 本地数据损坏时先摆提示条，绝不用空数据覆盖现场；
   *   3) 安卓壳内通知权限没开时，用一次带按钮的 toast 引导（每版一次）。
   * ===================================================================== */
  function bootButton(text, primary, onClick) {
    return UI.el('button', {
      class: 'btn' + (primary ? ' btn-primary' : ''),
      text: text,
      onclick: onClick
    });
  }

  function exportBootDiagnostics() {
    var payload = {
      at: new Date().toISOString(),
      app: { version: APP_VERSION, schema: global.Store ? Store.SCHEMA_VERSION : null },
      env: {
        userAgent: navigator.userAgent,
        viewport: [window.innerWidth, window.innerHeight],
        protocol: location.protocol,
        capacitor: !!global.Capacitor
      },
      loadIssue: global.Store ? (Store.loadIssue || null) : null,
      errors: (window.__cpErrors || []).slice(-20)
    };
    var body = JSON.stringify(payload, null, 2);
    if (global.SaveFile && SaveFile.save) {
      SaveFile.save('启动诊断-' + DateUtil.toStr(DateUtil.today()) + '.json', body,
        { mime: 'application/json', ext: 'json' }).catch(function () {});
    }
  }

  function showBootFailure(err) {
    try {
      var msg = (err && (err.stack || err.message)) || String(err || '未知错误');
      (window.__cpErrors = window.__cpErrors || []).push({
        at: new Date().toISOString(), kind: 'boot',
        msg: String(msg).slice(0, 300), extra: ''
      });
      if (typeof console !== 'undefined' && console.error) console.error('boot failed:', msg);
      var sk = document.getElementById('bootSkeleton');
      if (!sk) return;
      sk.innerHTML = '';
      sk.setAttribute('style', 'padding:40px 20px;max-width:560px;margin:0 auto;text-align:center;color:#64748b;font-size:13px');
      sk.appendChild(UI.el('div', {
        style: { fontSize: '17px', fontWeight: '700', color: 'var(--text)', marginBottom: '8px' },
        text: '启动失败'
      }));
      sk.appendChild(UI.el('div', {
        style: { lineHeight: '1.8', marginBottom: '12px' },
        text: '数据没有丢：本机存储没有被覆盖。可以先导出诊断信息，再点重试；如果反复失败，请用「设置 → 数据管理」里的备份恢复。'
      }));
      sk.appendChild(UI.el('pre', {
        text: String(msg).slice(0, 1200),
        style: {
          textAlign: 'left', fontSize: '11px', lineHeight: '1.5', whiteSpace: 'pre-wrap',
          background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: '8px',
          padding: '10px', maxHeight: '160px', overflow: 'auto', margin: '0 0 14px'
        }
      }));
      sk.appendChild(UI.el('div', { style: { display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' } }, [
        bootButton('重试', true, function () { location.reload(); }),
        bootButton('导出诊断', false, exportBootDiagnostics)
      ]));
    } catch (e) { /* 兜底本身失败就只能看控制台了 */ }
  }

  /** 本地数据损坏：先保住现场，再让用户选择出路。 */
  function showLoadIssueBanner() {
    try {
      var issue = global.Store && Store.loadIssue;
      if (!issue || document.getElementById('cpLoadIssueModal')) return;
      var ts = DateUtil.toStr(DateUtil.today());
      var leaving = false;   // 用户已经选了出路（导出不算），关窗后不再追着弹
      var m = UI.modal({
        title: '本地数据读取失败',
        width: '460px',
        onClose: function () {
          // 点 × 关掉不算做决定：数据仍在「禁止落盘」状态，过一会儿再提醒一次
          if (!leaving && global.Store && Store.loadIssue) setTimeout(showLoadIssueBanner, 800);
        },
        body: [
          UI.el('p', {
            style: { lineHeight: '1.8', margin: '0 0 8px' },
            text: '启动时读到的本地数据不是合法格式。原始内容已经另存为一份副本，'
              + '在你做出选择之前，App 不会写入任何数据，所以现场不会被覆盖。'
          }),
          UI.el('p', {
            style: { lineHeight: '1.8', margin: 0, color: 'var(--text-3)', fontSize: '12.5px' },
            text: '建议顺序：先导出副本留底 → 去「数据管理」从最近的备份恢复 → 确实没有备份再用空数据重来。'
          })
        ],
        footer: UI.el('div', { class: 'modal-foot' }, [
          bootButton('导出损坏副本', false, function () {
            var key = issue.key;
            var done = function (raw) {
              if (global.SaveFile && SaveFile.save) {
                SaveFile.save('损坏数据-' + ts + '.json', raw || '', { mime: 'application/json', ext: 'json' })
                  .then(function () { UI.toast('副本已导出', 'ok'); })
                  .catch(function () { UI.toast('导出失败', 'err'); });
              } else {
                UI.toast('当前环境不支持导出，请用浏览器开发者工具备份', 'err');
              }
            };
            if (key && Store.persist && Store.persist.load) {
              Store.persist.load(key).then(done).catch(function () { UI.toast('副本读取失败', 'err'); });
            } else {
              done('');
            }
          }),
          bootButton('去恢复备份', false, function () {
            leaving = true;
            m.close();
            App.go('settings', { tab: 'data', fromUrl: false });
          }),
          bootButton('用空数据继续', true, function () {
            UI.confirm({
              title: '确认用空数据继续？',
              message: '当前空状态会覆盖本机数据。已导出的副本和备份不受影响。',
              okText: '确认继续',
              danger: true,
              onOk: function () {
                leaving = true;
                Store.loadIssue = null;
                Store.save(true);
                m.close();
                if (App.current && App.current.render) App.current.render();
                UI.toast('已用空数据启动，建议尽快从备份恢复', 'info');
              }
            });
          })
        ])
      });
      if (m && m.root) m.root.id = 'cpLoadIssueModal';
    } catch (e) { /* 提示失败也要保证不写盘 */ }
  }

  /** 安卓壳内：通知权限没开时提醒一次（每版一次，不打扰） */
  function maybeAskNotifyPermission() {
    try {
      var cap = global.Capacitor;
      var np = cap && cap.Plugins && cap.Plugins.Notify;
      if (!np || typeof np.available !== 'function') return;
      if (global.Store && Store.loadIssue) return;
      if (document.querySelector('.cp-ob-mask')) return;
      var st = Store.state.settings || {};
      if (st.remind && st.remind.on === false) return;
      if (st.notifyHintVersion === APP_VERSION) return;
      np.available().then(function (r) {
        if (!r || r.notifications) return;
        st.notifyHintVersion = APP_VERSION;
        Store.save();
        UI.toastAction('通知未开启，上课提醒不会响', {
          actionText: '去开启',
          duration: 9000,
          onAction: function () {
            if (!np.requestPermission) return;
            np.requestPermission().then(function (res) {
              if (res && res.granted) {
                UI.toast('通知已开启，锁屏提醒已重排', 'ok');
                if (global.Remind && Remind.syncNative) Remind.syncNative(true);
              }
            }).catch(function () {});
          }
        });
      }).catch(function () {});
    } catch (e) { /* 静默 */ }
  }

  /**
   * 把完整备份写到系统「下载/CoursePlanner」。
   * 网页端没有这个能力，返回 false；App 内由 BackupExport 插件落盘。
   */
  function exportBackupToDownloads(withKeys) {
    var cap = global.Capacitor;
    var p = cap && cap.Plugins && cap.Plugins.BackupExport;
    if (!p || typeof p.saveToDownloads !== 'function') {
      UI.toast('这个功能只在 App 内可用', 'err');
      return Promise.resolve(false);
    }
    var text;
    try {
      text = Store.exportJSON('full', { includeKeys: !!withKeys });
    } catch (e) {
      UI.toast('生成备份失败', 'err');
      return Promise.resolve(false);
    }
    var name = 'course-planner-' + DateUtil.toStr(DateUtil.today()) + '.json';
    return p.saveToDownloads({ name: name, content: text }).then(function (r) {
      if (Store.markBackupExported) Store.markBackupExported();
      UI.toast('已保存到 ' + ((r && r.path) || '下载目录'), 'ok');
      return true;
    }).catch(function (e) {
      UI.toast('保存失败：' + (e && e.message ? e.message : e), 'err');
      return false;
    });
  }
  App.exportBackupToDownloads = exportBackupToDownloads;

  async function boot() {
    // 启动耗时探针：只打 console.info，不进 UI；排查「打开慢」时先看这三行
    var __t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
    var __mark = function (label) {
      if (typeof console === 'undefined' || !console.info) return;
      var t = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
      console.info('[boot] ' + label + ' +' + Math.round(t - __t0) + 'ms (t=' + Math.round(t) + 'ms)');
    };
    // 首帧时间：和 [boot] 对照，判断「脚本阻塞」占了多少
    try {
      if (global.PerformanceObserver) {
        new global.PerformanceObserver(function (list) {
          list.getEntries().forEach(function (e) {
            if (typeof console !== 'undefined' && console.info) {
              console.info('[paint] ' + e.name + ' ' + Math.round(e.startTime) + 'ms');
            }
          });
        }).observe({ type: 'paint', buffered: true });
      }
    } catch (e) { /* 忽略 */ }
    __mark('start');
    try {
      await Store.init();
    } catch (e) {
      if (typeof console !== 'undefined' && console.error) console.error('Store.init error:', e);
    }
    __mark('store.init');
    applyTopSafeArea();

    var isCap = !!(global.Capacitor || global.AndroidBridge);
    // Capacitor 安卓壳内严禁注册 PWA Service Worker（本地资源打包在 APK 内，SW 拦截 navigate 会导致二次打开 504 白屏）；
    // 同时在启动时主动注销可能残留的旧 SW 并清理旧缓存。
    if (isCap) {
      try {
        if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && navigator.serviceWorker.getRegistrations) {
          navigator.serviceWorker.getRegistrations().then(function (regs) {
            (regs || []).forEach(function (r) { try { r.unregister(); } catch (e) {} });
          }).catch(function () {});
        }
        if (typeof caches !== 'undefined' && caches.keys) {
          caches.keys().then(function (ks) {
            (ks || []).forEach(function (k) {
              if (k && k.indexOf('cp-app-') === 0) caches.delete(k).catch(function () {});
            });
          }).catch(function () {});
        }
      } catch (e) {}
    } else if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator &&
        (location.protocol === 'http:' || location.protocol === 'https:')) {
      onReady(function () {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      });
      watchSwUpdate();
    }
    if (!isCap) installManifest();
    setupAndroidBackButton();

    window.Pet.init();
    // 页面内上课提醒：只在页面可见时跑，不申请任何权限
    if (global.Remind) Remind.start();
    // 选项 A + B：健康联动自动同步（延后到首屏渲染完成之后执行，绝不阻塞二次打开首屏渲染）
    var syncHealthOnce = null;
    if (global.HealthConnect) {
      syncHealthOnce = function () {
        if (Store.settings && Store.settings.healthAutoSync === false) return;   // 开关关 -> 全部跳过
        if (Store.healthEnabled && !Store.healthEnabled()) return;
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        HealthConnect.autoSync().then(function (ok) {
          if (!ok) return;
          if (HealthConnect.persistAllToStore) {
            HealthConnect.persistAllToStore({ toastOnSleepAdd: true });
          }
        }).catch(function () {});
      };
      App.syncHealthOnce = syncHealthOnce;
  /** 消费并合并桌面小组件在离线或后台产生的操作变更 (Mutation Log) */
  function syncWidgetMutations() {
    var cap = (typeof window !== 'undefined' && window.Capacitor) ||
              (typeof global !== 'undefined' && global.Capacitor);
    var tw = cap && cap.Plugins && cap.Plugins.TodayWidget;
    if (!tw || typeof tw.getPendingWidgetMutations !== 'function') return Promise.resolve(0);

    return tw.getPendingWidgetMutations().then(function (res) {
      var muts = (res && res.mutations) || [];
      if (!Array.isArray(muts) || !muts.length) return 0;
      var count = 0;
      muts.forEach(function (m) {
        if (!m || !m.id) return;
        var t = Store.getTask(m.id);
        if (t) {
          var targetStatus = m.done ? 'done' : 'todo';
          if (t.status !== targetStatus) {
            Store.updateTask(m.id, {
              status: targetStatus,
              doneAt: m.done ? (m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString()) : null
            });
            count++;
          }
        }
      });
      if (count > 0) {
        if (App.current && App.current.render) App.current.render();
        Store.syncWidget();
      }
      return count;
    }).catch(function () { return 0; });
  }
  App.syncWidgetMutations = syncWidgetMutations;

      var HEALTH_SYNC_MS = 3 * 3600 * 1000;        // 3 小时
      setInterval(syncHealthOnce, HEALTH_SYNC_MS);
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') {
          syncHealthOnce();
          if (App.syncWidgetMutations) App.syncWidgetMutations();
          if (Store.syncWidget) Store.syncWidget();
        }
      });
    }
    if (global.Theme) { Theme.apply(); Theme.applyBackground(); }
    applySidebarMini();
    sortViews();
    buildNav();

    App.views.forEach(function (v) {
      if (v.init) v.init();
    });

    // 撤销栈：包裹删除类操作（删课程/待办/计划/目标/学期…），Ctrl+Z 可回滚
    if (global.Undo && global.Undo.attach) global.Undo.attach(Store);

    // 模块登记补全 + 启动期契约自检（只在缺东西时 console.error，不刷屏）
    if (global.CP) {
      CP.adopt(['Remind', 'Search', 'QrSync', 'SaveFile', 'Theme', 'Onboard', 'Pet', 'WhiteNoise',
        'WhitePaper', 'Speech', 'Ocr', 'HealthConnect', 'SleepModel', 'SleepNLP', 'TaskNLP',
        'HolidayCN', 'Lunar', 'AK_OPS', 'Palette', 'DragGesture', 'CourseException', 'PlanQuota',
        'ImportSafe', 'Undo', 'ScheduleExport', 'ScheduleLayout', 'StatsPane', 'QuadrantPane',
        'AgendaPane', 'ActivityPane', 'NotesPane', 'DiaryPane', 'GoalsPane', 'SettingsView',
        'TaskRow', 'TaskDialog', 'TaskShot', 'OcrDialog', 'StatsCalc', 'Store', 'UI', 'Router']);
      App.views.forEach(function (v) { CP.registerView(v); });
      CP.selfCheck();
    }

    var _remindSyncTimer = null;
    Store.subscribe(function () {
      renderTermCard();
      badge('tasks', Store.rootPending().length);
      if (App.current && App.current.render && !App.current.noAutoRender) App.current.render();
      App.views.forEach(function (v) { if (v.onDataChange) v.onDataChange(); });
      if (global.Remind && Remind.syncNative) {
        if (_remindSyncTimer) clearTimeout(_remindSyncTimer);
        _remindSyncTimer = setTimeout(function () {
          _remindSyncTimer = null;
          Remind.syncNative(false);
        }, 400);
      }
    });

    // 全局搜索：顶栏按钮 + Ctrl/⌘ + K
    var collapseBtn = UI.$('#btnCollapse');
    if (collapseBtn) collapseBtn.addEventListener('click', toggleSidebarMini);

    var shortcutsBtn = UI.$('#btnShortcuts');
    if (shortcutsBtn) shortcutsBtn.addEventListener('click', openShortcutsModal);

    var searchBtn = UI.$('#btnSearch');
    if (searchBtn) searchBtn.addEventListener('click', function () {
      if (global.Search) Search.open();
    });
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        if (!global.Search) return;
        e.preventDefault();
        Search.open();
        return;
      }
      // 撤销：只回滚删除类操作（见 assets/js/undo.js），不抢输入框里的原生撤销
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        var tagZ = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
        if (tagZ === 'INPUT' || tagZ === 'TEXTAREA' || !!(e.target && e.target.isContentEditable)) return;
        if (!global.Undo || !Store.canUndo || !Store.canUndo()) return;
        e.preventDefault();
        var un = Store.undo();
        if (un) UI.toast('已撤销：' + un.label);
        return;
      }
      var tag = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
      var inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!(e.target && e.target.isContentEditable);
      if (inInput) return;
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        var hubIdx = parseInt(e.key, 10);
        if (hubIdx >= 1 && hubIdx <= HUB_PARTITIONS.length) {
          e.preventDefault();
          go(HUB_PARTITIONS[hubIdx - 1].id);
          return;
        }
        if (e.key === 'n' || e.key === 'N') {
          if (global.TaskDialog && TaskDialog.open) { e.preventDefault(); TaskDialog.open(); }
          return;
        }
        if (e.key === 'c' || e.key === 'C') {
          if (global.EventDialog && EventDialog.open) { e.preventDefault(); EventDialog.open(); }
          return;
        }
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === '/' && !document.querySelector('.cp-modal-wrap, .cp-ob-mask')) {
          if (global.Search) { e.preventDefault(); Search.open(); }
        } else if (e.key === '?' && !document.querySelector('.cp-modal-wrap, .cp-ob-mask')) {
          e.preventDefault();
          openShortcutsModal();
        }
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
    if (Store.syncWidget) Store.syncWidget();
    checkSharedTargetShot();

    // 深链接：地址里带 #/today 之类的就从那个视图开始，否则用排序后的第一个
    var ids = App.views.map(function (v) { return v.id; });
    var startRoute = global.Router ? Router.initial(ids) : null;
    var startId = startRoute ? startRoute.id : (App.views[0] ? App.views[0].id : null);
    if (startId) go(startId, { tab: startRoute && startRoute.tab, fromUrl: true });
    __mark('first-render');
    if (syncHealthOnce) setTimeout(syncHealthOnce, 800);

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
        Onboard.start(Object.assign(
          startId ? { from: startId, fromTab: startRoute && startRoute.tab } : {},
          { onDone: function () { askHealthOnce(); } }
        ));
      }, 420);
    } else {
      // 老用户 / 已看过教程：等界面稳定一点再问，别和首屏动画抢
      setTimeout(askHealthOnce, 1200);
    }

    // 坏档提示优先于一切一次性引导；通知权限提示再晚一点，避开首屏动画
    setTimeout(showLoadIssueBanner, 350);
    setTimeout(maybeAskNotifyPermission, 2600);
    // 考后复盘：最近 3 天考完的科目，自动补一条复盘待办（每个考试只生成一次）
    setTimeout(function () {
      try {
        if (Store.syncExamReviews) {
          var n = Store.syncExamReviews();
          if (n > 0) UI.toast('已为 ' + n + ' 门考完的课生成复盘待办', 'ok');
        }
      } catch (e) { /* 静默 */ }
    }, 3200);
  }

  /**
   * 健康看板的首次询问：装完只问一次（问过即写 settings.healthOn.asked）。
   * 只在「装好的环境」里问——安卓壳（Capacitor）或装到桌面的 PWA。
   * 浏览器标签页里不弹：那里既读不到系统健康数据，也不该一打开就压一层弹窗。
   * 之后随时可以在「设置 → 模块显示」里开关，不需要再打扰。
   */
  /**
   * P2 第二层 Web Share Target：当用户从系统相册/小米运动健康直接将截图「分享」给本应用时，
   * Service Worker 会将图片存入 Cache Storage (cp-share-target-v1) 并重定向带 ?shared_shot=1。
   */
  function checkSharedTargetShot() {
    try {
      var hasParam = (location.search && location.search.indexOf('shared_shot=1') >= 0) ||
                     (location.hash && location.hash.indexOf('shared_shot=1') >= 0);
      if (!hasParam || typeof caches === 'undefined') return;
      if (history && history.replaceState) {
        var cleanSearch = (location.search || '').replace(/[?&]shared_shot=1/g, '').replace(/^&/, '?');
        var cleanHash = (location.hash || '').replace(/[?&]shared_shot=1/g, '');
        history.replaceState(null, '', location.pathname + cleanSearch + cleanHash);
      }
      caches.open('cp-share-target-v1').then(function (c) {
        return c.match('./__shared_image__').then(function (res) {
          if (!res) return null;
          c.delete('./__shared_image__');
          var rawName = res.headers.get('X-Shared-Name');
          var fname = rawName ? decodeURIComponent(rawName) : 'shared.png';
          var mime = res.headers.get('Content-Type') || 'image/png';
          return res.blob().then(function (blob) {
            return new File([blob], fname, { type: mime });
          });
        });
      }).then(function (file) {
        if (!file) return;
        openSharedShotModal(file);
      }).catch(function () {});
    } catch (e) {}
  }

  function openSharedShotModal(file) {
    var todayStr = DateUtil.toStr(DateUtil.today());
    var m = UI.modal({
      title: '📤 收到系统分享的截图',
      width: '420px',
      body: [
        UI.el('p', {
          style: { margin: '0 0 12px', fontSize: '13px', color: 'var(--text-2)', lineHeight: '1.6' },
          text: '请选择要对该截图执行的识别操作：'
        }),
        UI.el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, [
          UI.el('button', {
            class: 'btn btn-primary',
            style: { justifyContent: 'flex-start', padding: '10px 14px', height: 'auto' },
            onclick: function () {
              m.close();
              if (global.SleepDialog && SleepDialog.open) {
                SleepDialog.open(todayStr, null, { sharedFile: file });
              }
            }
          }, ['🌙 识别为「睡眠详情截图」（手环/小米运动健康）']),
          UI.el('button', {
            class: 'btn',
            style: { justifyContent: 'flex-start', padding: '10px 14px', height: 'auto' },
            onclick: function () {
              m.close();
              if (global.TaskShot && TaskShot.open) {
                TaskShot.open(file);
              }
            }
          }, ['📋 识别为「活动通知 / 群聊待办截图」']),
          UI.el('button', {
            class: 'btn',
            style: { justifyContent: 'flex-start', padding: '10px 14px', height: 'auto' },
            onclick: function () {
              m.close();
              if (global.OcrDialog && OcrDialog.open) {
                OcrDialog.open(file);
              }
            }
          }, ['📅 识别为「教务系统课表截图」'])
        ])
      ],
      footer: UI.el('div', { class: 'modal-foot' }, [
        UI.el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } })
      ])
    });
  }

  function askHealthOnce() {
    if (!Store.state || !Store.state.settings) return;
    if (Store.healthAsked && Store.healthAsked()) return;

    var inApp = !!(global.Capacitor && global.Capacitor.Plugins &&
                   global.Capacitor.Plugins.HealthConnect);
    var installed = !!(global.Capacitor || (App.isStandalone && App.isStandalone()));
    if (!installed) return;
    if (document.querySelector('.cp-modal')) return;      // 已有弹窗在前面，让位

    var body = UI.el('div', {}, [
      UI.el('p', {
        style: { margin: '0 0 10px', fontSize: '13px', lineHeight: '1.7', color: 'var(--text-2)' },
        text: '健康看板把睡眠、精力、热量、体重、步数汇成一页，还会和课表、番茄专注做交叉分析。'
      }),
      UI.el('p', {
        style: { margin: 0, fontSize: '12.5px', lineHeight: '1.7', color: 'var(--text-3)' },
        text: inApp
          ? '开启后可从手机 Health Connect 自动读取睡眠与活动量。不开启完全不影响其他功能。'
          : '当前环境读不到系统健康数据，但可以手动记录睡眠、活动量与体重。'
      })
    ]);

    var m = UI.modal({ title: '要不要开启健康看板？', width: '420px', body: body });
    m.setFooter(UI.el('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' } }, [
      UI.el('button', {
        class: 'btn',
        onclick: function () {
          m.close();
          Store.setHealthOn(false);
          UI.toast('健康看板已隐藏，可在「设置 → 模块显示」随时打开');
        }
      }, ['先不用']),
      UI.el('button', {
        class: 'btn btn-primary',
        onclick: function () {
          m.close();
          Store.setHealthOn(true);
          if (App.rebuildNav) App.rebuildNav();
          go('health');
          if (inApp && global.HealthConnect) {
            HealthConnect.request().then(function () {
              return HealthConnect.autoSync();
            }).then(function (ok) {
              if (ok && HealthConnect.persistAllToStore) {
                HealthConnect.persistAllToStore({ toastOnSleepAdd: true });
              }
              if (App.current && App.current.render) App.current.render();
            }).catch(function () {});
          }
        }
      }, ['开启'])
    ]));
  }

  function markActive(id) {
    UI.$$('.cp-nav-item').forEach(function (n) { n.classList.remove('cp-active'); n.removeAttribute('aria-current'); });
    UI.$$('.cp-tabbar-item').forEach(function (n) { n.classList.remove('cp-active'); n.removeAttribute('aria-current'); });
    var a1 = UI.$('#nav-' + id);
    if (a1) { a1.classList.add('cp-active'); a1.setAttribute('aria-current', 'page'); }

    var curTab = (App.current && typeof App.current.getTab === 'function') ? App.current.getTab() : null;
    var hub = hubOfView(id, curTab);
    if (hub) _hubMemory[hub.id] = { id: id, tab: curTab };

    if (isHub5Mode()) {
      var hubTab = hub ? UI.$('#tab-' + hub.id) : UI.$('#tab-' + id);
      if (hubTab) hubTab.classList.add('cp-active');
    } else {
      var a2 = UI.$('#tab-' + id);
      if (a2) a2.classList.add('cp-active');
      else {
        var more = UI.$('#tab-more');
        if (more) more.classList.add('cp-active');
      }
    }
    renderHubBar();
  }

  /**
   * 跨板块一键专注接力：从课程表/备考看板/待办详情/今日页点「🍅 专注」时，
   * 自动将目标待办关联到番茄钟（若无标签则自动继承课程名标签），并跳转到专注视图。
   */
  function focusTask(taskId, opts) {
    opts = opts || {};
    var t = taskId ? Store.getTask(taskId) : null;
    if (t) {
      var curTimer = (Store.pomodoro && Store.pomodoro.timer) ? Store.pomodoro.timer : {};
      var tags = (t.tags && t.tags.length) ? t.tags.join(',') : (curTimer.tags || '');
      if (!tags && t.courseId) {
        var c = Store.getCourse(t.courseId);
        if (c && c.name) tags = '学习/' + c.name;
      }
      if (!curTimer.running) {
        Store.saveTimer(Object.assign({}, curTimer, {
          taskId: t.id,
          courseId: t.courseId || '',
          tags: tags
        }));
      } else if (curTimer.taskId !== t.id) {
        var q = Array.isArray(curTimer.queue) ? curTimer.queue.slice() : [];
        if (q.indexOf(t.id) < 0) q.push(t.id);
        Store.saveTimer(Object.assign({}, curTimer, { queue: q }));
        UI.toast('当前正在专注，已将「' + t.title + '」加入专注队列');
        go('pomodoro', opts);
        return;
      } else {
        go('pomodoro', opts);
        UI.toast('当前正在专注：' + t.title);
        return;
      }
    }
    go('pomodoro', opts);
    if (t) UI.toast('已关联专注：' + t.title);
  }

  /**
   * 从课程详情 / 备考看板 / 今日课程直接发起某门课程的番茄专注：
   * 若该门课下已有未完成复习/作业待办则自动关联首条高优待办，否则直接绑定课程名标签与 courseId。
   */
  function focusCourse(courseId, opts) {
    opts = opts || {};
    var c = courseId ? Store.getCourse(courseId) : null;
    if (!c) { go('pomodoro'); return; }
    var pending = (Store.tasks || []).filter(function (t) {
      return t && t.status !== 'done' && !t.parentId && t.courseId === c.id;
    });
    if (pending.length) {
      focusTask(pending[0].id, opts);
      return;
    }
    var curTimer = (Store.pomodoro && Store.pomodoro.timer) ? Store.pomodoro.timer : {};
    var tagStr = '学习/' + c.name;
    if (!curTimer.running) {
      Store.saveTimer(Object.assign({}, curTimer, {
        taskId: '',
        courseId: c.id,
        tags: tagStr
      }));
      go('pomodoro', opts);
      UI.toast('已开启《' + c.name + '》学科专注');
    } else {
      go('pomodoro', opts);
      UI.toast(curTimer.courseId === c.id
        ? ('当前正在进行《' + c.name + '》学科专注')
        : ('当前专注计时运行中，请先结束当前番茄再切换《' + c.name + '》'));
    }
  }

  /** 打开全局键盘快捷键速查弹窗（桌面无障碍导航增强） */
  function openShortcutsModal() {
    var rows = [
      ['Ctrl / ⌘ + K 或 /', '打开全局跨模块搜索'],
      ['Ctrl / ⌘ + Z', '撤销上一次删除（课程 / 待办 / 计划 / 目标 / 学期）'],
      ['Alt + 1 ~ 6', '快速切换六大核心分区（今日/课表/待办/计划/专注/我的）'],
      ['Alt + N', '快速打开「新建待办」弹窗'],
      ['Alt + C', '快速打开「新建日程」弹窗'],
      ['?', '打开本键盘快捷键速查面板'],
      ['Esc', '关闭当前顶层弹窗 / 浮层']
    ];
    var list = UI.el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
      rows.map(function (r) {
        return UI.el('div', {
          style: {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: '12px', padding: '8px 10px', borderRadius: '8px',
            background: 'var(--surface-2)', border: '1px solid var(--line)'
          }
        }, [
          UI.el('span', { style: { fontSize: '12.5px', color: 'var(--text-2)' }, text: r[1] }),
          UI.el('kbd', {
            style: {
              padding: '2px 8px', borderRadius: '6px', fontSize: '11.5px',
              fontFamily: 'monospace', fontWeight: '600',
              background: 'var(--surface)', border: '1px solid var(--line-strong)', color: 'var(--primary)'
            },
            text: r[0]
          })
        ]);
      })
    );
    var m = UI.modal({
      title: '⌨️ 键盘快捷键一览',
      width: '440px',
      body: [
        UI.el('p', {
          style: { margin: '0 0 10px', fontSize: '12.5px', color: 'var(--text-3)', lineHeight: '1.6' },
          text: '在电脑网页端非输入框焦点状态下，可使用以下快捷键高效切换与记录：'
        }),
        list
      ],
      footer: UI.el('div', { class: 'modal-foot' }, [
        UI.el('button', { class: 'btn btn-primary', text: '知道了', onclick: function () { m.close(); } })
      ])
    });
  }

  App.go = go;
  App.focusTask = focusTask;
  App.focusCourse = focusCourse;
  App.openShortcutsModal = openShortcutsModal;
  App.badge = badge;
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

  /** boot 用的 async 函数一旦 reject 就会静默停在骨架屏，这里统一兜底。 */
  function bootSafe() {
    var p;
    try {
      p = boot();
    } catch (e) {
      showBootFailure(e);
      return;
    }
    if (p && typeof p.catch === 'function') p.catch(showBootFailure);
  }

  // 单测沙箱里 document.readyState 不存在，不启动整套 boot（会去碰真实 DOM / 主题）。
  if (typeof document !== 'undefined' && typeof document.readyState === 'string') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bootSafe);
    } else bootSafe();
  }
  if (global.CP && global.CP.register) global.CP.register('App', App);
})(window);


