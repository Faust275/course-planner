/* ==========================================================
 * 模块显式登记表与启动期 API 契约自检 (CP Registry & Contract Self-Check)
 * ----------------------------------------------------------
 * 解决模块间隐式依赖 global.X 加载顺序、以及调用了未定义方法（如 Store.toggleEvent）
 * 只有在用户点击按钮时才抛 TypeError 的问题。
 * ========================================================== */
(function (global) {
  'use strict';

  var modules = {};
  var order = [];

  var CORE_CONTRACTS = {
    Store: [
      'init', 'ensure', 'save', 'reset',
      'addCourse', 'updateCourse', 'removeCourse', 'getCourse', 'coursesOnDate', 'courseExams', 'examsOf',
      'addTask', 'updateTask', 'removeTask', 'toggleTask', 'getTask', 'rootTasks', 'pendingTasks', 'todayTasks', 'overdueTasks',
      'addEvent', 'updateEvent', 'removeEvent', 'toggleEvent', 'getEvent', 'eventsOf', 'upcomingEvents',
      'addPlan', 'updatePlan', 'removePlan', 'activePlans', 'plansActive',
      'addGoal', 'updateGoal', 'removeGoal',
      'addLedger', 'removeLedger',
      'addNote', 'removeNote', 'saveDiary',
      'diffImport', 'validateBackupVersion', 'importJSON', 'exportJSON', 'backupNow', 'listBackups', 'restoreBackup',
      'backupHealth', 'markBackupExported', 'snoozeBackupRemind',
      'detectDayConflicts', 'dayLoadSummary',
      'inferDayEnergyModel', 'autoAllocateTaskTime', 'applyTaskSchedule', 'dayTimeline',
      'getPomoStrict', 'setPomoStrict', 'getNightDiscipline', 'setNightDiscipline', 'isInNightDisciplineWindow'
    ],
    UI: [
      'el', 'svg', '$', '$$', 'escapeHTML',
      'toast', 'toastAction', 'modal', 'confirm', 'diffPanel',
      'field', 'input', 'textarea', 'select', 'toggle', 'segment', 'colorPicker', 'empty', 'statCard'
    ],
    Router: ['parse', 'build', 'resolve'],
    StatsCalc: ['expandRange', 'mergeTotal', 'seriesFromLog', 'ledgerBreakdown', 'sumByCourse'],
    App: ['go', 'renderHubBar', 'focusCourse', 'rebuildNav']
  };

  var CP = {
    modules: modules,
    order: order,
    CORE_CONTRACTS: CORE_CONTRACTS,

    /**
     * 显式登记模块，同时挂载到 global[name] 保持向后兼容
     * @param {string} name 模块名
     * @param {*} mod 模块导出对象
     */
    register: function (name, mod) {
      if (!name || !mod) return mod;
      modules[name] = mod;
      if (order.indexOf(name) < 0) order.push(name);
      if (global && global[name] !== mod) global[name] = mod;
      return mod;
    },

    /**
     * 显式获取已登记模块；若缺失且未提供 fallback 则抛出可读错误
     * @param {string} name 模块名
     * @param {*} [fallback] 可选降级值
     */
    require: function (name, fallback) {
      var mod = modules[name] || (global && global[name]);
      if (mod !== undefined && mod !== null) return mod;
      if (arguments.length >= 2) return fallback;
      throw new Error('[CP.require] 核心依赖模块未就绪: ' + name);
    },

    /** 判断模块是否已就绪 */
    has: function (name) {
      return !!(modules[name] || (global && global[name]));
    },

    /**
     * 登记视图对象。视图不走 register()：register 会把模块挂到 window 上，
     * 而 window['view.schedule'] 这种键没有意义，徒增全局污染。
     */
    registerView: function (view) {
      if (!view || !view.id) return null;
      var key = 'view.' + view.id;
      modules[key] = view;
      if (order.indexOf(key) < 0) order.push(key);
      return view;
    },

    /**
     * 把「已经挂在 window 上、但没走 register」的老模块补登记。
     * 目的不是改它们的写法，而是让 CP.modules 成为一份可信清单：
     * 启动自检、诊断包、以后按模块懒加载都靠它。
     */
    adopt: function (names) {
      (names || []).forEach(function (n) {
        if (modules[n]) return;
        var m = global && global[n];
        if (m === undefined || m === null) return;
        modules[n] = m;
        if (order.indexOf(n) < 0) order.push(n);
      });
      return order.length;
    },

    /**
     * 启动期 API 契约自检：校验核心模块及关键方法是否全部就绪，
     * 杜绝「视图层调用了 Store.xxx 但 Store 未实现」的隐蔽回归。
     * @param {{silent?:boolean, sourceCode?:string}} [opts]
     */
    selfCheck: function (opts) {
      opts = opts || {};
      var missingModules = [];
      var missingMethods = [];

      Object.keys(CORE_CONTRACTS).forEach(function (modName) {
        var mod = modules[modName] || (global && global[modName]);
        if (!mod) {
          missingModules.push(modName);
          return;
        }
        var methods = CORE_CONTRACTS[modName] || [];
        methods.forEach(function (fnName) {
          if (typeof mod[fnName] !== 'function') {
            missingMethods.push(modName + '.' + fnName);
          }
        });
      });

      // 若传入了完整源码文本（如单测或构建期自检），自动扫描所有 Store.xxx( / UI.xxx( / Router.xxx( / StatsCalc.xxx( 字面量调用
      if (opts.sourceCode && typeof opts.sourceCode === 'string') {
        var clean = opts.sourceCode.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
        ['Store', 'UI', 'Router', 'StatsCalc', 'DateUtil', 'TimeUtil'].forEach(function (targetName) {
          var targetObj = modules[targetName] || (global && global[targetName]);
          if (!targetObj) return;
          var rx = new RegExp('\\b' + targetName + '\\.([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*\\(', 'g');
          var seen = {};
          var m;
          while ((m = rx.exec(clean)) !== null) {
            var fn = m[1];
            if (seen[fn]) continue;
            seen[fn] = 1;
            if (typeof targetObj[fn] !== 'function') {
              var key = targetName + '.' + fn;
              if (missingMethods.indexOf(key) < 0) missingMethods.push(key);
            }
          }
        });
      }

      var ok = missingModules.length === 0 && missingMethods.length === 0;
      if (!ok && !opts.silent && typeof console !== 'undefined' && console.error) {
        console.error('[CP.selfCheck] 启动期 API 契约自检发现缺失:', {
          missingModules: missingModules,
          missingMethods: missingMethods
        });
      }
      return {
        ok: ok,
        missingModules: missingModules,
        missingMethods: missingMethods,
        registered: order.slice()
      };
    }
  };

  global.CP = CP;
})(typeof window !== 'undefined' ? window : globalThis);
