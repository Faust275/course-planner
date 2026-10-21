/* ==========================================================
 * Router：URL hash 深链接
 * ----------------------------------------------------------
 * 目的：把网页「添加到主屏幕」后，快捷方式能直接落到某个模块；
 *       也方便把「今日课表」「写日记」单独存成书签或发给别人。
 *
 * 地址形态：
 *   index.html#/today          今日
 *   index.html#/tasks          待办
 *   index.html#/tasks/diary    待办页的「日记」分页
 *   index.html#/diary          同上（别名，给快捷方式用的短名字）
 *
 * 为什么用 hash 而不是路径：交付是一个可以直接双击打开的单文件，
 * file:// 下没有服务器做 history 回退，hash 是唯一两种打开方式都稳的做法。
 * ========================================================== */
(function (global) {
  'use strict';

  /* 别名：好记的短名字 → 真实的「视图 / 分页」。
     日记和灵感都住在「待办」页里，单独给个入口才符合直觉。 */
  var ALIAS = {
    diary: { id: 'tasks', tab: 'diary' },
    notes: { id: 'tasks', tab: 'notes' },
    inspiration: { id: 'tasks', tab: 'notes' },
    goals: { id: 'plans', tab: 'goals' },
    // 合并后原来的独立模块改挂到宿主页的分页，旧深链接照常生效
    agenda: { id: 'calendar', tab: 'agenda' },
    quadrant: { id: 'tasks', tab: 'quadrant' },
    stats: { id: 'tasks', tab: 'stats' }
  };

  /** 取一段地址并做最宽松的规整：去掉 #、/ 与首尾空白 */
  function segOf(s) {
    try { return decodeURIComponent(s).trim().toLowerCase(); }
    catch (e) { return String(s).trim().toLowerCase(); }
  }

  /**
   * '#/tasks/diary' → { id: 'tasks', tab: 'diary' }
   * 认不出来（空、没有 #/、只有 #/）一律返回 null，交回默认视图
   */
  function parse(hash) {
    var s = String(hash == null ? '' : hash).trim();
    if (s.charAt(0) === '#') s = s.slice(1);
    // 只认 #/xxx：裸 #anchor 留给页面内跳转，不去抢它的语义
    if (s.charAt(0) !== '/') return null;
    var seg = s.slice(1).split('/').filter(function (x) { return x; });
    if (!seg.length) return null;
    var id = segOf(seg[0]);
    if (!id) return null;
    var alias = ALIAS[id];
    if (alias) return { id: alias.id, tab: alias.tab };
    return { id: id, tab: seg[1] ? segOf(seg[1]) || null : null };
  }

  /** 反过来：('tasks', 'diary') → '#/tasks/diary' */
  function build(id, tab) {
    return '#/' + String(id) + (tab ? '/' + String(tab) : '');
  }

  /**
   * 解析并校验视图是否存在。ids 传当前所有视图 id 的数组。
   * 不存在就返回 null——地址栏里手改出来的错字不该把页面搞白。
   */
  function resolve(hash, ids) {
    var r = parse(hash);
    if (!r) return null;
    if (ids && ids.indexOf(r.id) < 0) return null;
    return r;
  }

  var R = {
    last: null,       // 上一次落地过的路由，用来区分「自己写的地址」和「用户真的改了地址」
    apply: null,      // 由 app.js 注入的回调：function (route) { ... }
    onInvalid: null   // 地址认不出来时的兜底（把地址修回当前页）
  };

  R.parse = parse;
  R.build = build;
  R.resolve = resolve;

  /** 启动时读一次：地址里带合法深链接就从那里开始 */
  R.initial = function (ids) {
    return resolve(global.location && location.hash, ids);
  };

  /**
   * 导航落地后回写地址栏。
   * 用 replaceState：返回键应该退出应用/回上一页，而不是在模块之间来回跳。
   * file:// 下部分浏览器不允许改地址，此时静默放弃——功能本身不受影响。
   */
  R.set = function (id, tab) {
    var want = build(id, tab || null);
    R.last = { id: id, tab: tab || null };
    if (!global.location) return want;
    if (location.hash === want) return want;
    try {
      if (global.history && history.replaceState) history.replaceState(null, '', want);
      else location.hash = want.slice(1);
    } catch (e) {
      try { location.hash = want.slice(1); } catch (e2) { /* 改不了就算了 */ }
    }
    return want;
  };

  /** 挂上监听：用户手改地址、点浏览器前进/后退时切视图 */
  R.start = function (ids, apply) {
    R.apply = apply;
    function onUrl() {
      var r = resolve(location.hash, ids());
      if (!r) { if (R.onInvalid) R.onInvalid(location.hash); return; }
      // 自己刚写进去的地址会回声一次，比对 last 后直接跳过
      if (R.last && R.last.id === r.id && (R.last.tab || null) === (r.tab || null)) return;
      apply(r);
    }
    global.addEventListener('hashchange', onUrl);
    global.addEventListener('popstate', onUrl);
  };

  global.Router = R;
})(window);
